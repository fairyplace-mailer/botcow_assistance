import type OpenAI from 'openai';
import type { Response } from 'openai/resources/responses/responses';

import type { AssistantInternalCode, AssistantResult, RunAssistantTurnParams } from '../assistant';
import { compactAssistantMessages } from '../compaction';
import { buildExecutionProfile } from '../guards/assistantExecutionProfile';
import { filterToolsForMode } from '../guards/toolPolicy';
import { logEvent, logInfo, logWarn } from '../log';
import { getOpenAIClient } from '../openai';
import { getResponsesRuntimeCapabilities } from '../openaiRuntime';
import { allMessagesText, normalizeContentToText } from '../prompt/normalizeContentToText';
import { buildContextAugmentedInstructions } from '../retrieval/buildContextAugmentedInstructions';
import {
  buildStrictFunctionTools,
  extractConversationId,
  extractFinalAssistantMessage,
  extractFunctionCalls,
  responseUsage,
  validateResponsesToolsContract,
} from '../responses';
import { getToolsSchemas, handleToolCall } from '../tools';
import { classifyProviderError, createModelResponseWithRetry } from './providerRuntime';
import { resolveReasoningDecision, type ReasoningDecision } from './reasoningPolicy';
import { payloadKeysForStateMode, selectResponsesStateMode } from './responsesState';
import { executePreparedToolCall, prepareToolCall } from './toolCallRuntime';
import { applyFingerprintGuard, evaluateNoProgress, exceedsToolBudget } from './toolLoopPolicy';

type ToolResultClass =
  | 'ok'
  | 'invalid_tool_args_json'
  | 'invalid_tool_args_schema'
  | 'unknown_tool'
  | 'tool_timeout'
  | 'tool_execution_failed'
  | 'tool_not_allowed';

const MAX_NO_PROGRESS_ROUNDS = 2;

function abort(code: AssistantInternalCode, responseId?: string) {
  return {
    publicCode: 'assistant_run_failed' as const,
    publicMessage: 'Не удалось завершить действие автоматически. Попробуйте ещё раз.',
    internalCode: code,
    ...(responseId ? { responseId } : {}),
  };
}

function normalizeMessagesToInput(
  messages: Array<{ role: string; content: unknown }>,
): OpenAI.Responses.ResponseInputItem[] {
  const normalized: OpenAI.Responses.ResponseInputItem[] = [];

  for (const message of messages) {
    if (!message || typeof message.role !== 'string') continue;
    const text = normalizeContentToText(message.content);
    if (!text) continue;

    const role =
      message.role === 'user' || message.role === 'assistant' || message.role === 'system' || message.role === 'developer'
        ? message.role
        : 'user';

    normalized.push({
      type: 'message',
      role: role as any,
      content: [{ type: 'input_text', text }],
    });
  }

  return normalized;
}

async function logFatalStop(event: string, payload: Parameters<typeof logWarn>[1]) {
  await logWarn(event, { ...payload, finalStatus: 'failed' });
}

function buildFailureState(responseId?: string | null) {
  return {
    previousResponseId: responseId ?? null,
  };
}

function readIncompleteReason(response: Response | null): string | null {
  const anyResponse = response as any;
  if (!anyResponse || anyResponse.status !== 'incomplete') return null;
  const reason = anyResponse?.incomplete_details?.reason;
  if (typeof reason === 'string' && reason.trim()) return reason.trim();
  return 'unknown';
}

export async function runAssistantRuntime(params: RunAssistantTurnParams): Promise<AssistantResult> {
  const startedAt = Date.now();
  const traceId = `assistant_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const userTurnId = traceId;
  const toolCallsLog: AssistantResult['toolCalls'] = [];

  let lastResponse: Response | null = null;
  let lastReasoningDecision: ReasoningDecision = {
    requestedReasoningEffort: params.routing.reasoning?.effort ?? null,
    sentReasoningEffort: null,
    reasoningSuppressedReason: null,
  };

  const compactedMessages = compactAssistantMessages(params.messages);
  const requestMessages = compactedMessages.messages;

  if (compactedMessages.applied) {
    await logInfo('assistant_messages_compacted', {
      traceId,
      userTurnId,
      originalMessageCount: compactedMessages.originalCount,
      compactedMessageCount: compactedMessages.compactedCount,
      droppedMessageCount: compactedMessages.droppedMessageCount,
      keptRecentMessageCount: compactedMessages.keptRecentCount,
      finalStatus: 'in_progress',
      duration: Date.now() - startedAt,
    });
  }

  const executionProfile = buildExecutionProfile({
    baseInstructions: params.instructions,
    detectionText: `${params.instructions}\n${allMessagesText(requestMessages)}`,
  });
  const toolPolicyMode = executionProfile.readOnlyTools ? 'repo_audit' : 'default';

  const contextAugmentation = await buildContextAugmentedInstructions({
    instructions: executionProfile.instructions,
    messages: requestMessages,
  });
  const effectiveInstructions = contextAugmentation.instructions;

  await logInfo('assistant_context_retrieval_status', {
    traceId,
    userTurnId,
    assistantMode: executionProfile.mode,
    retrievalStatus: contextAugmentation.retrieval.status,
    retrievalSource: contextAugmentation.retrieval.source,
    retrievalQuery: contextAugmentation.retrieval.query,
    finalStatus: 'in_progress',
    duration: Date.now() - startedAt,
  });

  let pendingInput = normalizeMessagesToInput(requestMessages);
  let previousResponseId: string | undefined = params.state.previousResponseId;
  let currentConversationId: string | null = null;
  let totalToolCalls = 0;
  let noProgressRounds = 0;
  let lastFingerprint: string | null = null;
  let sameFingerprintInRow = 0;

  const openai = getOpenAIClient();
  const tools = buildStrictFunctionTools(
    filterToolsForMode(params.tools ?? getToolsSchemas(toolPolicyMode) ?? [], toolPolicyMode),
  );
  const toolContract = validateResponsesToolsContract(tools);
  const invalidToolContract = toolContract.ok
    ? null
    : (toolContract as { ok: false; issues: string[] });

  if (invalidToolContract) {
    const error = abort('invalid_tool_schema');
    await logFatalStop('assistant_run_failed', {
      traceId,
      userTurnId,
      assistantMode: executionProfile.mode,
      stopReason: error.internalCode,
      schemaValid: false,
      toolResultClass: 'invalid_tool_args_schema',
      duration: Date.now() - startedAt,
      toolSchemaIssues: invalidToolContract.issues,
    });
    return {
      response: null,
      toolCalls: toolCallsLog,
      reasoningDecision: lastReasoningDecision,
      state: buildFailureState(previousResponseId),
      error,
    };
  }

  for (let round = 1; round <= executionProfile.maxToolLoops; round += 1) {
    const runtimeCapabilities = getResponsesRuntimeCapabilities();

    const stateMode = selectResponsesStateMode({
      ...(previousResponseId ? { previousResponseId } : {}),
    });

    const reasoningDecision = resolveReasoningDecision(params.routing, runtimeCapabilities, {
      stateMode,
      pendingInput,
    });
    lastReasoningDecision = reasoningDecision;

    const requestPreviousResponseId =
      stateMode.kind === 'previous_response' ? stateMode.previousResponseId : undefined;
    const requestConversationId = currentConversationId;

    await logInfo('assistant_round_started', {
      traceId,
      userTurnId,
      round,
      previousResponseId: requestPreviousResponseId ?? null,
      totalToolCalls,
      model: params.routing.model,
      modelReason: params.routing.reason,
      reasoningEffort: reasoningDecision.sentReasoningEffort,
      assistantMode: executionProfile.mode,
      finalStatus: 'in_progress',
      duration: Date.now() - startedAt,
    });

    let response: Response;
    try {
      response = await createModelResponseWithRetry(
        {
          client: openai,
          model: params.routing.model,
          input: pendingInput,
          instructions: effectiveInstructions,
          state: stateMode,
          tools,
          ...(reasoningDecision.sentReasoningEffort
            ? { reasoning: { effort: reasoningDecision.sentReasoningEffort, summary: 'concise' as const } }
            : {}),
          ...(params.routing.text ? { text: params.routing.text } : {}),
          ...(typeof params.routing.maxOutputTokens === 'number'
            ? { maxOutputTokens: params.routing.maxOutputTokens }
            : {}),
        },
        {
          onRetry: async (meta) => {
            await logEvent('assistant_openai_retry_scheduled', {
              traceId,
              userTurnId,
              round,
              previousResponseId: requestPreviousResponseId ?? null,
              model: params.routing.model,
              modelReason: params.routing.reason,
              reasoningEffort: reasoningDecision.sentReasoningEffort,
              assistantMode: executionProfile.mode,
              attempt: meta.attempt,
              nextAttempt: meta.nextAttempt,
              delayMs: meta.delayMs,
              status: meta.status,
              code: meta.code,
              finalStatus: 'in_progress',
              duration: Date.now() - startedAt,
            });
          },
        },
      );
    } catch (error: any) {
      const internalCode = classifyProviderError(error);
      const failure = abort(internalCode);

      await logFatalStop('assistant_run_failed', {
        traceId,
        userTurnId,
        round,
        previousResponseId: requestPreviousResponseId ?? null,
        totalToolCalls,
        model: params.routing.model,
        modelReason: params.routing.reason,
        reasoningEffort: reasoningDecision.sentReasoningEffort,
        assistantMode: executionProfile.mode,
        stopReason: failure.internalCode,
        providerStatus: error?.status ?? error?.statusCode ?? error?.cause?.status ?? null,
        providerCode: error?.code ?? error?.cause?.code ?? null,
        providerType: error?.type ?? error?.error?.type ?? null,
        error: error?.message ?? String(error),
        duration: Date.now() - startedAt,
      });

      return {
        response: lastResponse,
        toolCalls: toolCallsLog,
        reasoningDecision,
        state: buildFailureState(previousResponseId),
        error: failure,
      };
    }

    lastResponse = response;
    previousResponseId = response.id;

    const functionCalls = extractFunctionCalls((response as any).output);
    const finalMessage = extractFinalAssistantMessage(response);
    const incompleteReason = readIncompleteReason(response);

    await logInfo('assistant_round_completed', {
      traceId,
      userTurnId,
      round,
      responseId: response.id ?? null,
      previousResponseId: requestPreviousResponseId ?? null,
      totalToolCalls,
      model: params.routing.model,
      modelReason: params.routing.reason,
      reasoningEffort: reasoningDecision.sentReasoningEffort,
      toolName: functionCalls[0]?.name ?? null,
      toolCallId: functionCalls[0]?.call_id ?? null,
      assistantMode: executionProfile.mode,
      assistantPhase: finalMessage?.phase ?? null,
      finalStatus:
        incompleteReason
          ? 'failed'
          : finalMessage?.text && functionCalls.length === 0
            ? 'completed'
            : 'in_progress',
      duration: Date.now() - startedAt,
      usage: responseUsage(response),
    });

    await logEvent('openai_request_completed', {
      traceId,
      userTurnId,
      path: runtimeCapabilities.path,
      methodWrapper: 'openai.responses.create',
      model: params.routing.model,
      modelReason: params.routing.reason,
      reasoningEffort: reasoningDecision.sentReasoningEffort,
      requestedReasoningEffort: reasoningDecision.requestedReasoningEffort,
      sentReasoningEffort: reasoningDecision.sentReasoningEffort,
      reasoningSuppressedReason: reasoningDecision.reasoningSuppressedReason,
      sdkVersion: runtimeCapabilities.sdkVersion,
      runtimeReasoningSupport: runtimeCapabilities.reasoning,
      runtimeKind: runtimeCapabilities.runtimeKind,
      apiBaseUrl: runtimeCapabilities.apiBaseUrl,
      previousResponseId: requestPreviousResponseId ?? null,
      responseId: response.id ?? null,
      round,
      duration: Date.now() - startedAt,
      usage: responseUsage(response),
      toolCount: functionCalls.length,
      assistantMode: executionProfile.mode,
      incompleteReason,
      assistantPhase: finalMessage?.phase ?? null,
      finalStatus: incompleteReason ? 'failed' : 'in_progress',
      payloadKeys: [
        'model',
        'input',
        'instructions',
        ...(reasoningDecision.sentReasoningEffort ? ['reasoning'] : []),
        ...(params.routing.text ? ['text'] : []),
        ...(typeof params.routing.maxOutputTokens === 'number' ? ['max_output_tokens'] : []),
        'tools',
        'parallel_tool_calls',
        ...payloadKeysForStateMode(stateMode),
      ],
    });

    if (incompleteReason) {
      const error = abort('response_incomplete', response.id);
      await logFatalStop('assistant_run_failed', {
        traceId,
        userTurnId,
        round,
        responseId: response.id ?? null,
        previousResponseId: requestPreviousResponseId ?? null,
        totalToolCalls,
        model: params.routing.model,
        modelReason: params.routing.reason,
        reasoningEffort: reasoningDecision.sentReasoningEffort,
        assistantMode: executionProfile.mode,
        assistantPhase: finalMessage?.phase ?? null,
        stopReason: error.internalCode,
        incompleteReason,
        duration: Date.now() - startedAt,
        usage: responseUsage(response),
      });
      return {
        response,
        toolCalls: toolCallsLog,
        reasoningDecision,
        state: buildFailureState(response.id),
        error,
      };
    }

    if (finalMessage?.text && functionCalls.length === 0) {
      await logInfo('assistant_run_completed', {
        traceId,
        userTurnId,
        responseId: response.id ?? null,
        previousResponseId: requestPreviousResponseId ?? null,
        totalToolCalls,
        model: params.routing.model,
        modelReason: params.routing.reason,
        reasoningEffort: reasoningDecision.sentReasoningEffort,
        assistantMode: executionProfile.mode,
        assistantPhase: finalMessage.phase ?? null,
        finalStatus: 'completed',
        duration: Date.now() - startedAt,
        usage: responseUsage(response),
      });

      return {
        response,
        toolCalls: toolCallsLog,
        reasoningDecision,
        state: {
          previousResponseId: response.id ?? null,
        },
      };
    }

    if (functionCalls.length === 0) {
      const error = abort('no_actionable_output', response.id);
      await logFatalStop('assistant_run_failed', {
        traceId,
        userTurnId,
        round,
        responseId: response.id ?? null,
        previousResponseId: requestPreviousResponseId ?? null,
        assistantMode: executionProfile.mode,
        stopReason: error.internalCode,
        duration: Date.now() - startedAt,
        usage: responseUsage(response),
      });
      return {
        response,
        toolCalls: toolCallsLog,
        reasoningDecision,
        state: buildFailureState(response.id),
        error,
      };
    }

    if (
      exceedsToolBudget({
        totalToolCalls,
        requestedCalls: functionCalls.length,
        maxTotalToolCalls: executionProfile.maxTotalToolCalls,
      })
    ) {
      const error = abort('tool_budget_exceeded', response.id);
      await logFatalStop('assistant_run_failed', {
        traceId,
        userTurnId,
        round,
        responseId: response.id ?? null,
        previousResponseId: requestPreviousResponseId ?? null,
        assistantMode: executionProfile.mode,
        stopReason: error.internalCode,
        totalToolCalls,
        requestedCalls: functionCalls.length,
        duration: Date.now() - startedAt,
      });
      return {
        response,
        toolCalls: toolCallsLog,
        reasoningDecision,
        state: buildFailureState(response.id),
        error,
      };
    }

    let progressThisRound = false;
    const nextInput: OpenAI.Responses.ResponseInputItem[] = [];
    const roundFingerprints: string[] = [];
    const previousFingerprintBeforeRound = lastFingerprint;

    for (const call of functionCalls) {
      const preparedCall = prepareToolCall(call, tools);
      const failedPreparedCall = preparedCall.ok
        ? null
        : (preparedCall as {
            ok: false;
            code: 'unknown_tool' | 'invalid_tool_args_json' | 'invalid_tool_args_schema';
            argsParseOk?: boolean;
            schemaValid?: boolean;
            argsHash?: string;
          });
      if (failedPreparedCall) {
        toolCallsLog.push({ tool_call_id: call.call_id, name: call.name, ok: false, error: failedPreparedCall.code });
        const error = abort(failedPreparedCall.code, response.id);
        await logFatalStop('assistant_run_failed', {
          traceId,
          userTurnId,
          round,
          responseId: response.id ?? null,
          previousResponseId: requestPreviousResponseId ?? null,
          toolName: call.name,
          toolCallId: call.call_id,
          ...(failedPreparedCall.argsHash ? { argsHash: failedPreparedCall.argsHash } : {}),
          ...(failedPreparedCall.argsParseOk !== undefined ? { argsParseOk: failedPreparedCall.argsParseOk } : {}),
          ...(failedPreparedCall.schemaValid !== undefined ? { schemaValid: failedPreparedCall.schemaValid } : {}),
          toolResultClass: failedPreparedCall.code,
          assistantMode: executionProfile.mode,
          assistantPhase: finalMessage?.phase ?? null,
          stopReason: error.internalCode,
          duration: Date.now() - startedAt,
          usage: responseUsage(response),
        });
        return {
          response,
          toolCalls: toolCallsLog,
          reasoningDecision,
          state: buildFailureState(response.id),
          error,
        };
      }

      const successfulPreparedCall = preparedCall as {
        ok: true;
        normalizedArgs: Record<string, unknown>;
        argsHash: string;
        fingerprint: string;
      };
      const { normalizedArgs, argsHash, fingerprint } = successfulPreparedCall;
      roundFingerprints.push(fingerprint);

      const fingerprintDecision = applyFingerprintGuard({
        fingerprint,
        lastFingerprint,
        sameFingerprintInRow,
        maxSameFingerprintInRow: executionProfile.maxSameFingerprintInRow,
      });
      sameFingerprintInRow = fingerprintDecision.sameFingerprintInRow;

      if (fingerprintDecision.repeated) {
        toolCallsLog.push({ tool_call_id: call.call_id, name: call.name, ok: false, error: 'repeated_tool_call' });
        const error = abort('repeated_tool_call', response.id);
        await logFatalStop('assistant_run_failed', {
          traceId,
          userTurnId,
          round,
          responseId: response.id ?? null,
          previousResponseId: requestPreviousResponseId ?? null,
          toolName: call.name,
          toolCallId: call.call_id,
          argsHash,
          argsParseOk: true,
          schemaValid: true,
          assistantMode: executionProfile.mode,
          assistantPhase: finalMessage?.phase ?? null,
          stopReason: error.internalCode,
          duration: Date.now() - startedAt,
          usage: responseUsage(response),
        });
        return {
          response,
          toolCalls: toolCallsLog,
          reasoningDecision,
          state: buildFailureState(response.id),
          error,
        };
      }

      const result = await executePreparedToolCall({
        name: call.name,
        normalizedArgs,
        timeoutMs: executionProfile.toolTimeoutMs,
        execute: (name, args) => handleToolCall(name, args, toolPolicyMode),
      });
      const toolLatencyMs = result.toolLatencyMs;

      const failedToolResult = result.ok
        ? null
        : (result as {
            ok: false;
            code: 'tool_timeout' | 'tool_execution_failed' | 'tool_not_allowed';
            error?: string;
            toolLatencyMs: number;
          });
      if (failedToolResult) {
        lastFingerprint = fingerprint;
        toolCallsLog.push({ tool_call_id: call.call_id, name: call.name, ok: false, error: failedToolResult.code });
        const error = abort(
          failedToolResult.code === 'tool_timeout'
            ? 'tool_timeout'
            : failedToolResult.code === 'tool_not_allowed'
              ? 'tool_not_allowed'
              : 'tool_execution_failed',
          response.id,
        );
        await logFatalStop('assistant_run_failed', {
          traceId,
          userTurnId,
          round,
          responseId: response.id ?? null,
          previousResponseId: requestPreviousResponseId ?? null,
          toolName: call.name,
          toolCallId: call.call_id,
          argsHash,
          argsParseOk: true,
          schemaValid: true,
          toolLatencyMs,
          toolResultClass: failedToolResult.code,
          assistantMode: executionProfile.mode,
          assistantPhase: finalMessage?.phase ?? null,
          stopReason: error.internalCode,
          duration: Date.now() - startedAt,
          usage: responseUsage(response),
        });
        return {
          response,
          toolCalls: toolCallsLog,
          reasoningDecision,
          state: buildFailureState(response.id),
          error,
        };
      }

      lastFingerprint = fingerprint;
      totalToolCalls += 1;
      progressThisRound = true;
      toolCallsLog.push({ tool_call_id: call.call_id, name: call.name, ok: true });
      const successfulToolResult = result as {
        ok: true;
        output: unknown;
        toolLatencyMs: number;
      };

      nextInput.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(successfulToolResult.output),
      });

      await logInfo('assistant_tool_succeeded', {
        traceId,
        userTurnId,
        round,
        responseId: response.id ?? null,
        previousResponseId: requestPreviousResponseId ?? null,
        totalToolCalls,
        model: params.routing.model,
        modelReason: params.routing.reason,
        reasoningEffort: reasoningDecision.sentReasoningEffort,
        toolName: call.name,
        toolCallId: call.call_id,
        argsHash,
        argsParseOk: true,
        schemaValid: true,
        toolLatencyMs,
        toolResultClass: 'ok' as ToolResultClass,
        assistantMode: executionProfile.mode,
        assistantPhase: finalMessage?.phase ?? null,
        finalStatus: 'in_progress',
        duration: Date.now() - startedAt,
        usage: responseUsage(response),
      });
    }

    const noProgressDecision = evaluateNoProgress({
      progressThisRound,
      hasFinalText: Boolean(finalMessage?.text),
      roundFingerprints,
      previousFingerprintBeforeRound,
      noProgressRounds,
      maxNoProgressRounds: MAX_NO_PROGRESS_ROUNDS,
    });
    const fingerprintChanged = noProgressDecision.fingerprintChanged;
    noProgressRounds = noProgressDecision.noProgressRounds;

    if (noProgressDecision.shouldAbort) {
      const error = abort('no_progress_abort', response.id);
      await logFatalStop('assistant_run_failed', {
        traceId,
        userTurnId,
        round,
        responseId: response.id ?? null,
        previousResponseId: requestPreviousResponseId ?? null,
        assistantMode: executionProfile.mode,
        assistantPhase: finalMessage?.phase ?? null,
        stopReason: error.internalCode,
        progressThisRound,
        fingerprintChanged,
        noProgressRounds,
        duration: Date.now() - startedAt,
        usage: responseUsage(response),
      });
      return {
        response,
        toolCalls: toolCallsLog,
        reasoningDecision,
        state: buildFailureState(response.id),
        error,
      };
    }

    pendingInput = nextInput;
  }

  const error = abort('tool_loop_limit', lastResponse?.id);
  await logFatalStop('assistant_run_failed', {
    traceId,
    userTurnId,
    responseId: lastResponse?.id ?? null,
    previousResponseId: previousResponseId ?? null,
    assistantMode: executionProfile.mode,
    stopReason: error.internalCode,
    totalToolCalls,
    duration: Date.now() - startedAt,
    usage: lastResponse ? responseUsage(lastResponse) : null,
  });

  return {
    response: lastResponse,
    toolCalls: toolCallsLog,
    reasoningDecision: lastReasoningDecision,
    state: buildFailureState(previousResponseId),
    error,
  };
}
