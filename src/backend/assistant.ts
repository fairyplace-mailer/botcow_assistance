import { createHash } from 'crypto';

import { getOpenAIClient } from './openai';
import { getToolsSchemas, handleToolCall } from './tools';
import type { ModelRoutingDecision, ReasoningEffort } from './modelRouter';
import type OpenAI from 'openai';
import type { Response } from 'openai/resources/responses/responses';
import {
  buildStrictFunctionTools,
  createModelResponse,
  extractFinalAssistantMessage,
  extractFunctionCalls,
  responseUsage,
} from './responses';
import { logEvent, logInfo, logWarn } from './log';
import {
  getResponsesRuntimeCapabilities,
  supportsReasoning,
  REASONING_ALLOWED_EFFORTS,
  type ReasoningSuppressedReason,
  type ResponsesRuntimeCapabilities,
} from './openaiRuntime';

const MAX_TOOL_LOOPS = 12;
const MAX_TOTAL_TOOL_CALLS = 24;
const MAX_SAME_FINGERPRINT_IN_ROW = 2;
const MAX_NO_PROGRESS_ROUNDS = 2;
const TOOL_TIMEOUT_MS = 20_000;

type ToolResultClass =
  | 'ok'
  | 'invalid_tool_args_json'
  | 'invalid_tool_args_schema'
  | 'unknown_tool'
  | 'tool_timeout'
  | 'tool_execution_failed';

type AssistantInternalCode =
  | 'invalid_tool_args_json'
  | 'invalid_tool_args_schema'
  | 'unknown_tool'
  | 'tool_timeout'
  | 'tool_execution_failed'
  | 'repeated_tool_call'
  | 'no_progress_abort'
  | 'tool_budget_exceeded'
  | 'no_actionable_output'
  | 'tool_loop_limit';

export type AssistantRunOptions = {
  model: ModelRoutingDecision['model'];
  reasoning?: { effort: ReasoningEffort };
  reason?: string;
};

export type ConversationStateRef = {
  conversationId?: string;
  previousResponseId?: string;
};

export type RunAssistantTurnParams = {
  instructions: string;
  userInput: string;
  tools?: OpenAI.Responses.Tool[];
  routing: AssistantRunOptions;
  state: ConversationStateRef;
};

interface AssistantResult {
  response: Response | null;
  completion: null;
  toolCalls: Array<{
    tool_call_id: string;
    name: string;
    ok: boolean;
    error?: string;
  }>;
  reasoningDecision: ReasoningDecision;
  state: {
    conversationId: string | null;
    latestResponseId: string | null;
  };
  error?: {
    publicCode: 'assistant_run_failed';
    publicMessage: string;
    internalCode: AssistantInternalCode;
    responseId?: string;
  };
}

export type ReasoningDecision = {
  requestedReasoningEffort: ReasoningEffort | null;
  sentReasoningEffort: ReasoningEffort | null;
  reasoningSuppressedReason: ReasoningSuppressedReason | null;
};

export { getResponsesRuntimeCapabilities, supportsReasoning };
export type { ResponsesRuntimeCapabilities, ReasoningSuppressedReason };

export function resolveReasoningDecision(
  routing: Pick<ModelRoutingDecision, 'model' | 'reasoning'>,
  runtimeCapabilities: ResponsesRuntimeCapabilities,
): ReasoningDecision {
  const requestedReasoningEffort = routing.reasoning?.effort ?? null;

  if (!requestedReasoningEffort) {
    return {
      requestedReasoningEffort,
      sentReasoningEffort: null,
      reasoningSuppressedReason: null,
    };
  }

  const allowedEfforts = REASONING_ALLOWED_EFFORTS[routing.model];

  if (!allowedEfforts?.size) {
    return {
      requestedReasoningEffort,
      sentReasoningEffort: null,
      reasoningSuppressedReason: 'model_not_supported',
    };
  }

  if (!allowedEfforts.has(requestedReasoningEffort)) {
    return {
      requestedReasoningEffort,
      sentReasoningEffort: null,
      reasoningSuppressedReason: 'sdk_contract_unknown',
    };
  }

  if (runtimeCapabilities.reasoning === 'unsupported') {
    return {
      requestedReasoningEffort,
      sentReasoningEffort: null,
      reasoningSuppressedReason: 'runtime_not_supported',
    };
  }

  if (runtimeCapabilities.reasoning === 'unknown') {
    return {
      requestedReasoningEffort,
      sentReasoningEffort: null,
      reasoningSuppressedReason: 'sdk_contract_unknown',
    };
  }

  if (!supportsReasoning(routing.model, runtimeCapabilities)) {
    return {
      requestedReasoningEffort,
      sentReasoningEffort: null,
      reasoningSuppressedReason: 'runtime_not_supported',
    };
  }

  return {
    requestedReasoningEffort,
    sentReasoningEffort: requestedReasoningEffort,
    reasoningSuppressedReason: null,
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(',')}}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashArgs(args: unknown): string {
  return sha256(stableStringify(args));
}

function makeToolFingerprint(
  toolName: string,
  args: unknown,
  prevResultClass: ToolResultClass | null,
): string {
  return sha256(`${toolName}\n${stableStringify(args)}\n${prevResultClass ?? 'none'}`);
}

function safeParseToolArgs(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

function abort(code: AssistantInternalCode, responseId?: string) {
  return {
    publicCode: 'assistant_run_failed' as const,
    publicMessage: 'Не удалось завершить действие автоматически. Попробуйте ещё раз.',
    internalCode: code,
    ...(responseId ? { responseId } : {}),
  };
}

function getToolDefinition(name: string, tools: OpenAI.Responses.Tool[] | undefined) {
  if (!Array.isArray(tools) || tools.length === 0) {
    return undefined;
  }

  return tools.find((tool: any) => tool?.type === 'function' && tool?.name === name) as
    | OpenAI.Responses.FunctionTool
    | undefined;
}

function validateToolArgsAgainstSchema(
  schema: Record<string, unknown> | null | undefined,
  value: unknown,
): { ok: true } | { ok: false; issues: string[] } {
  if (!schema || typeof schema !== 'object') {
    return { ok: true };
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, issues: ['arguments must be an object'] };
  }

  const objectValue = value as Record<string, unknown>;
  const properties =
    schema.properties && typeof schema.properties === 'object'
      ? (schema.properties as Record<string, Record<string, unknown>>)
      : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === 'string')
    : [];
  const additionalProperties = schema.additionalProperties;
  const issues: string[] = [];

  for (const key of required) {
    if (!(key in objectValue)) {
      issues.push(`missing required field: ${key}`);
    }
  }

  for (const [key, item] of Object.entries(objectValue)) {
    const propSchema = properties[key];

    if (!propSchema) {
      if (additionalProperties === false) {
        issues.push(`unexpected field: ${key}`);
      }
      continue;
    }

    const expectedType = propSchema.type;
    if (typeof expectedType === 'string') {
      const actualType = Array.isArray(item) ? 'array' : item === null ? 'null' : typeof item;
      if (expectedType !== actualType) {
        issues.push(`field ${key} must be ${expectedType}`);
      }
    }
  }

  return issues.length ? { ok: false, issues } : { ok: true };
}

async function runToolWithTimeout(
  name: string,
  args: unknown,
  timeoutMs: number,
): Promise<
  | { ok: true; output: unknown }
  | { ok: false; code: 'tool_timeout' | 'tool_execution_failed'; error?: string }
> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = await Promise.race([
      handleToolCall(name, args),
      new Promise<never>((_, reject) => {
        const error = new Error(`Tool timed out after ${timeoutMs}ms`);
        error.name = 'TimeoutError';
        timeoutId = setTimeout(() => reject(error), timeoutMs);
      }),
    ]);

    return { ok: true, output: result };
  } catch (error: any) {
    if (error?.name === 'TimeoutError') {
      return { ok: false, code: 'tool_timeout', error: error.message };
    }

    return {
      ok: false,
      code: 'tool_execution_failed',
      error: error?.message ? String(error.message) : String(error),
    };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function finalizeSuccess(result: AssistantResult): AssistantResult {
  return result;
}

function finalizeFailure(
  params: Omit<AssistantResult, 'error'> & {
    error: NonNullable<AssistantResult['error']>;
  },
): AssistantResult {
  return params;
}

export async function runAssistant(params: RunAssistantTurnParams): Promise<AssistantResult> {
  const startedAt = Date.now();
  const toolCallsLog: AssistantResult['toolCalls'] = [];
  let lastResponse: Response | null = null;
  let lastReasoningDecision: ReasoningDecision = {
    requestedReasoningEffort: params.routing.reasoning?.effort ?? null,
    sentReasoningEffort: null,
    reasoningSuppressedReason: null,
  };

  let pendingInput: OpenAI.Responses.ResponseInputItem[] = [
    {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: params.userInput }],
    },
  ];
  let previousResponseId: string | undefined = params.state.previousResponseId;
  let totalToolCalls = 0;
  let noProgressRounds = 0;
  let lastFingerprint: string | null = null;
  let sameFingerprintInRow = 0;
  let lastToolResultClass: ToolResultClass | null = null;

  const openai = getOpenAIClient();
  const tools = buildStrictFunctionTools(params.tools ?? getToolsSchemas() ?? []);
  const traceId = `assistant_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const userTurnId = traceId;

  for (let round = 1; round <= MAX_TOOL_LOOPS; round += 1) {
    const runtimeCapabilities = getResponsesRuntimeCapabilities();
    const reasoningDecision = resolveReasoningDecision(params.routing, runtimeCapabilities);
    lastReasoningDecision = reasoningDecision;

    await logInfo('assistant_round_start', {
      traceId,
      userTurnId,
      round,
      conversationId: params.state.conversationId ?? null,
      previousResponseId: previousResponseId ?? null,
      totalToolCalls,
      model: params.routing.model,
      modelReason: params.routing.reason,
      reasoningEffort: reasoningDecision.sentReasoningEffort,
      finalStatus: 'in_progress',
      duration: Date.now() - startedAt,
    });

    const requestPreviousResponseId = previousResponseId;
    const response = await createModelResponse({
      client: openai,
      model: params.routing.model,
      input: pendingInput,
      instructions: params.instructions,
      previousResponseId: requestPreviousResponseId,
      conversation: params.state.conversationId
        ? { id: params.state.conversationId }
        : undefined,
      tools,
      ...(reasoningDecision.sentReasoningEffort
        ? { reasoning: { effort: reasoningDecision.sentReasoningEffort } }
        : {}),
    });

    lastResponse = response;
    previousResponseId = response.id;

    let functionCalls;
    try {
      functionCalls = extractFunctionCalls(response.output);
    } catch {
      const error = abort('no_actionable_output', response.id);
      await logWarn('assistant_invalid_function_call_cycle', {
        traceId,
        userTurnId,
        round,
        conversationId: params.state.conversationId ?? null,
        responseId: response.id ?? null,
        previousResponseId: requestPreviousResponseId ?? null,
        stopReason: error.internalCode,
        finalStatus: 'failed',
        duration: Date.now() - startedAt,
        usage: responseUsage(response),
      });
      return finalizeFailure({
        response,
        completion: null,
        toolCalls: toolCallsLog,
        reasoningDecision,
        state: {
          conversationId: params.state.conversationId ?? null,
          latestResponseId: response.id ?? null,
        },
        error,
      });
    }

    const finalMessage = extractFinalAssistantMessage(response);

    await logInfo('assistant_round_response', {
      traceId,
      userTurnId,
      round,
      conversationId: params.state.conversationId ?? null,
      responseId: response.id ?? null,
      previousResponseId: requestPreviousResponseId ?? null,
      totalToolCalls,
      model: params.routing.model,
      modelReason: params.routing.reason,
      reasoningEffort: reasoningDecision.sentReasoningEffort,
      toolName: functionCalls[0]?.name ?? null,
      toolCallId: functionCalls[0]?.call_id ?? null,
      argsHash: null,
      argsParseOk: null,
      schemaValid: null,
      toolLatencyMs: null,
      toolResultClass: null,
      assistantPhase: finalMessage?.phase ?? null,
      stopReason: null,
      finalStatus: finalMessage?.text && functionCalls.length === 0 ? 'completed' : 'in_progress',
      duration: Date.now() - startedAt,
      usage: responseUsage(response),
    });

    await logEvent('openai-request', {
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
      conversationId: params.state.conversationId ?? null,
      previousResponseId: requestPreviousResponseId ?? null,
      responseId: response.id ?? null,
      round,
      duration: Date.now() - startedAt,
      usage: responseUsage(response),
      toolCount: functionCalls.length,
      assistantPhase: finalMessage?.phase ?? null,
      finalStatus: 'in_progress',
      payloadKeys: [
        'model',
        'input',
        'instructions',
        ...(reasoningDecision.sentReasoningEffort ? ['reasoning'] : []),
        'tools',
        'parallel_tool_calls',
        ...(params.state.conversationId ? ['conversation'] : []),
        ...(requestPreviousResponseId ? ['previous_response_id'] : []),
      ],
    });

    if (finalMessage?.text && functionCalls.length === 0) {
      await logInfo('assistant_run_completed', {
        traceId,
        userTurnId,
        conversationId: params.state.conversationId ?? null,
        responseId: response.id ?? null,
        previousResponseId: requestPreviousResponseId ?? null,
        totalToolCalls,
        model: params.routing.model,
        modelReason: params.routing.reason,
        reasoningEffort: reasoningDecision.sentReasoningEffort,
        assistantPhase: finalMessage.phase ?? null,
        finalStatus: 'completed',
        duration: Date.now() - startedAt,
        usage: responseUsage(response),
      });
      return finalizeSuccess({
        response,
        completion: null,
        toolCalls: toolCallsLog,
        reasoningDecision,
        state: {
          conversationId: params.state.conversationId ?? null,
          latestResponseId: response.id ?? null,
        },
      });
    }

    if (totalToolCalls + functionCalls.length > MAX_TOTAL_TOOL_CALLS) {
      const error = abort('tool_budget_exceeded', response.id);
      await logWarn('assistant_tool_budget_exceeded', {
        traceId,
        userTurnId,
        round,
        conversationId: params.state.conversationId ?? null,
        responseId: response.id ?? null,
        previousResponseId: requestPreviousResponseId ?? null,
        stopReason: error.internalCode,
        totalToolCalls,
        requestedCalls: functionCalls.length,
        finalStatus: 'failed',
        duration: Date.now() - startedAt,
      });
      return finalizeFailure({
        response,
        completion: null,
        toolCalls: toolCallsLog,
        reasoningDecision,
        state: {
          conversationId: params.state.conversationId ?? null,
          latestResponseId: response.id ?? null,
        },
        error,
      });
    }

    let progressThisRound = false;
    const nextInput: OpenAI.Responses.ResponseInputItem[] = [];
    const roundFingerprints: string[] = [];
    const previousFingerprintBeforeRound = lastFingerprint;

    for (const call of functionCalls) {
      const tool = getToolDefinition(call.name, tools);
      if (!tool) {
        toolCallsLog.push({ tool_call_id: call.call_id, name: call.name, ok: false, error: 'unknown_tool' });
        const error = abort('unknown_tool', response.id);
        await logWarn('assistant_unknown_tool', {
          traceId,
          userTurnId,
          round,
          conversationId: params.state.conversationId ?? null,
          responseId: response.id ?? null,
          previousResponseId: requestPreviousResponseId ?? null,
          toolName: call.name,
          toolCallId: call.call_id,
          toolResultClass: 'unknown_tool',
          assistantPhase: finalMessage?.phase ?? null,
          stopReason: error.internalCode,
          finalStatus: 'failed',
          duration: Date.now() - startedAt,
          usage: responseUsage(response),
        });
        return finalizeFailure({
          response,
          completion: null,
          toolCalls: toolCallsLog,
          reasoningDecision,
          state: {
            conversationId: params.state.conversationId ?? null,
            latestResponseId: response.id ?? null,
          },
          error,
        });
      }

      const parsed = safeParseToolArgs(call.arguments);
      if (!parsed.ok) {
        toolCallsLog.push({
          tool_call_id: call.call_id,
          name: call.name,
          ok: false,
          error: 'invalid_tool_args_json',
        });
        const error = abort('invalid_tool_args_json', response.id);
        await logWarn('assistant_invalid_tool_args_json', {
          traceId,
          userTurnId,
          round,
          conversationId: params.state.conversationId ?? null,
          responseId: response.id ?? null,
          previousResponseId: requestPreviousResponseId ?? null,
          toolName: call.name,
          toolCallId: call.call_id,
          argsParseOk: false,
          toolResultClass: 'invalid_tool_args_json',
          assistantPhase: finalMessage?.phase ?? null,
          stopReason: error.internalCode,
          finalStatus: 'failed',
          duration: Date.now() - startedAt,
          usage: responseUsage(response),
        });
        return finalizeFailure({
          response,
          completion: null,
          toolCalls: toolCallsLog,
          reasoningDecision,
          state: {
            conversationId: params.state.conversationId ?? null,
            latestResponseId: response.id ?? null,
          },
          error,
        });
      }

      const argsHash = hashArgs(parsed.value);
      const schemaValidation = validateToolArgsAgainstSchema(
        (tool.parameters as Record<string, unknown> | null | undefined) ?? null,
        parsed.value,
      );
      if (!schemaValidation.ok) {
        toolCallsLog.push({
          tool_call_id: call.call_id,
          name: call.name,
          ok: false,
          error: 'invalid_tool_args_schema',
        });
        const error = abort('invalid_tool_args_schema', response.id);
        await logWarn('assistant_invalid_tool_args_schema', {
          traceId,
          userTurnId,
          round,
          conversationId: params.state.conversationId ?? null,
          responseId: response.id ?? null,
          previousResponseId: requestPreviousResponseId ?? null,
          toolName: call.name,
          toolCallId: call.call_id,
          argsHash,
          argsParseOk: true,
          schemaValid: false,
          toolResultClass: 'invalid_tool_args_schema',
          assistantPhase: finalMessage?.phase ?? null,
          stopReason: error.internalCode,
          finalStatus: 'failed',
          duration: Date.now() - startedAt,
          usage: responseUsage(response),
        });
        return finalizeFailure({
          response,
          completion: null,
          toolCalls: toolCallsLog,
          reasoningDecision,
          state: {
            conversationId: params.state.conversationId ?? null,
            latestResponseId: response.id ?? null,
          },
          error,
        });
      }

      const fingerprint = makeToolFingerprint(call.name, parsed.value, lastToolResultClass);
      roundFingerprints.push(fingerprint);

      if (fingerprint === lastFingerprint) {
        sameFingerprintInRow += 1;
      } else {
        sameFingerprintInRow = 1;
      }

      if (sameFingerprintInRow >= MAX_SAME_FINGERPRINT_IN_ROW) {
        toolCallsLog.push({
          tool_call_id: call.call_id,
          name: call.name,
          ok: false,
          error: 'repeated_tool_call',
        });
        const error = abort('repeated_tool_call', response.id);
        await logWarn('assistant_repeated_tool_call', {
          traceId,
          userTurnId,
          round,
          conversationId: params.state.conversationId ?? null,
          responseId: response.id ?? null,
          previousResponseId: requestPreviousResponseId ?? null,
          toolName: call.name,
          toolCallId: call.call_id,
          argsHash,
          argsParseOk: true,
          schemaValid: true,
          toolResultClass: lastToolResultClass,
          assistantPhase: finalMessage?.phase ?? null,
          stopReason: error.internalCode,
          finalStatus: 'failed',
          duration: Date.now() - startedAt,
          usage: responseUsage(response),
        });
        return finalizeFailure({
          response,
          completion: null,
          toolCalls: toolCallsLog,
          reasoningDecision,
          state: {
            conversationId: params.state.conversationId ?? null,
            latestResponseId: response.id ?? null,
          },
          error,
        });
      }

      const startedToolAt = Date.now();
      const result = await runToolWithTimeout(call.name, parsed.value, TOOL_TIMEOUT_MS);
      const toolLatencyMs = Date.now() - startedToolAt;

      if (!result.ok) {
        lastToolResultClass = result.code;
        lastFingerprint = fingerprint;
        toolCallsLog.push({
          tool_call_id: call.call_id,
          name: call.name,
          ok: false,
          error: result.code,
        });
        const error = abort(result.code === 'tool_timeout' ? 'tool_timeout' : 'tool_execution_failed', response.id);
        await logWarn('assistant_tool_failed', {
          traceId,
          userTurnId,
          round,
          conversationId: params.state.conversationId ?? null,
          responseId: response.id ?? null,
          previousResponseId: requestPreviousResponseId ?? null,
          toolName: call.name,
          toolCallId: call.call_id,
          argsHash,
          argsParseOk: true,
          schemaValid: true,
          toolLatencyMs,
          toolResultClass: result.code,
          assistantPhase: finalMessage?.phase ?? null,
          stopReason: error.internalCode,
          finalStatus: 'failed',
          duration: Date.now() - startedAt,
          usage: responseUsage(response),
        });
        return finalizeFailure({
          response,
          completion: null,
          toolCalls: toolCallsLog,
          reasoningDecision,
          state: {
            conversationId: params.state.conversationId ?? null,
            latestResponseId: response.id ?? null,
          },
          error,
        });
      }

      lastToolResultClass = 'ok';
      lastFingerprint = fingerprint;
      totalToolCalls += 1;
      progressThisRound = true;
      toolCallsLog.push({ tool_call_id: call.call_id, name: call.name, ok: true });
      nextInput.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(result.output),
      });

      await logInfo('assistant_tool_ok', {
        traceId,
        userTurnId,
        round,
        conversationId: params.state.conversationId ?? null,
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
        toolResultClass: 'ok',
        assistantPhase: finalMessage?.phase ?? null,
        finalStatus: 'in_progress',
        duration: Date.now() - startedAt,
        usage: responseUsage(response),
      });
    }

    const roundFingerprint = roundFingerprints.length ? roundFingerprints.join('|') : null;
    const fingerprintChanged = roundFingerprint !== previousFingerprintBeforeRound;

    if (!progressThisRound && !finalMessage?.text && !fingerprintChanged) {
      noProgressRounds += 1;
    } else {
      noProgressRounds = 0;
    }

    if (noProgressRounds >= MAX_NO_PROGRESS_ROUNDS) {
      const error = abort('no_progress_abort', response.id);
      await logWarn('assistant_no_progress_abort', {
        traceId,
        userTurnId,
        round,
        conversationId: params.state.conversationId ?? null,
        responseId: response.id ?? null,
        previousResponseId: requestPreviousResponseId ?? null,
        toolName: functionCalls[0]?.name ?? null,
        toolCallId: functionCalls[0]?.call_id ?? null,
        assistantPhase: finalMessage?.phase ?? null,
        stopReason: error.internalCode,
        finalStatus: 'failed',
        duration: Date.now() - startedAt,
        usage: responseUsage(response),
      });
      return finalizeFailure({
        response,
        completion: null,
        toolCalls: toolCallsLog,
        reasoningDecision,
        state: {
          conversationId: params.state.conversationId ?? null,
          latestResponseId: response.id ?? null,
        },
        error,
      });
    }

    if (functionCalls.length === 0 && !finalMessage?.text) {
      const error = abort('no_actionable_output', response.id);
      await logWarn('assistant_no_actionable_output', {
        traceId,
        userTurnId,
        round,
        conversationId: params.state.conversationId ?? null,
        responseId: response.id ?? null,
        previousResponseId: requestPreviousResponseId ?? null,
        assistantPhase: finalMessage?.phase ?? null,
        stopReason: error.internalCode,
        finalStatus: 'failed',
        duration: Date.now() - startedAt,
        usage: responseUsage(response),
      });
      return finalizeFailure({
        response,
        completion: null,
        toolCalls: toolCallsLog,
        reasoningDecision,
        state: {
          conversationId: params.state.conversationId ?? null,
          latestResponseId: response.id ?? null,
        },
        error,
      });
    }

    pendingInput = nextInput;
  }

  const error = abort('tool_loop_limit', previousResponseId);
  await logWarn('assistant_tool_loop_limit', {
    traceId,
    userTurnId,
    conversationId: params.state.conversationId ?? null,
    responseId: previousResponseId ?? null,
    previousResponseId: previousResponseId ?? null,
    totalToolCalls,
    model: params.routing.model,
    modelReason: params.routing.reason,
    reasoningEffort: lastReasoningDecision.sentReasoningEffort,
    stopReason: error.internalCode,
    finalStatus: 'failed',
    duration: Date.now() - startedAt,
  });

  return finalizeFailure({
    response: lastResponse,
    completion: null,
    toolCalls: toolCallsLog,
    reasoningDecision: lastReasoningDecision,
    state: {
      conversationId: params.state.conversationId ?? null,
      latestResponseId: previousResponseId ?? null,
    },
    error,
  });
}
