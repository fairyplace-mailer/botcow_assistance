import { createHash } from 'crypto';

import { getOpenAIClient } from './openai';
import { getToolsSchemas, handleToolCall } from './tools';
import type { ModelRoutingDecision, ReasoningEffort } from './modelRouter';
import type OpenAI from 'openai';
import type { Response } from 'openai/resources/responses/responses';
import {
  buildResponsesInput,
  createModelResponse,
  extractFinalAssistantMessage,
  extractFunctionCalls,
  responseUsage,
  type AssistantMessage,
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

function getToolDefinition(name: string, tools: OpenAI.Responses.Tool[]) {
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
  try {
    const result = await Promise.race([
      handleToolCall(name, args),
      new Promise<never>((_, reject) => {
        const error = new Error(`Tool timed out after ${timeoutMs}ms`);
        error.name = 'TimeoutError';
        setTimeout(() => reject(error), timeoutMs);
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
  }
}

export async function runAssistant(
  rawMessages: AssistantMessage[],
  routing: Pick<ModelRoutingDecision, 'model' | 'reasoning'>,
): Promise<AssistantResult> {
  const built = buildResponsesInput(rawMessages);
  const toolCallsLog: AssistantResult['toolCalls'] = [];
  let lastResponse: Response | null = null;
  let lastReasoningDecision: ReasoningDecision = {
    requestedReasoningEffort: routing.reasoning?.effort ?? null,
    sentReasoningEffort: null,
    reasoningSuppressedReason: null,
  };

  let pendingInput = built.input;
  let previousResponseId: string | undefined;
  let totalToolCalls = 0;
  let noProgressRounds = 0;
  let lastFingerprint: string | null = null;
  let sameFingerprintInRow = 0;
  let lastToolResultClass: ToolResultClass | null = null;

  const openai = getOpenAIClient();
  const tools = getToolsSchemas();
  const traceId = `assistant_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  for (let round = 1; round <= MAX_TOOL_LOOPS; round += 1) {
    const runtimeCapabilities = getResponsesRuntimeCapabilities();
    const reasoningDecision = resolveReasoningDecision(routing, runtimeCapabilities);
    lastReasoningDecision = reasoningDecision;

    await logInfo('assistant_round_start', {
      traceId,
      round,
      previousResponseId: previousResponseId ?? null,
      totalToolCalls,
    });

    const response = await createModelResponse({
      client: openai,
      model: routing.model,
      input: pendingInput,
      instructions: built.instructions,
      previousResponseId,
      tools,
      ...(reasoningDecision.sentReasoningEffort
        ? { reasoning: { effort: reasoningDecision.sentReasoningEffort } }
        : {}),
    });

    lastResponse = response;
    previousResponseId = response.id;

    const functionCalls = extractFunctionCalls(response.output);
    const finalMessage = extractFinalAssistantMessage(response);

    await logEvent('openai-request', {
      traceId,
      path: runtimeCapabilities.path,
      methodWrapper: 'openai.responses.create',
      model: routing.model,
      requestedReasoningEffort: reasoningDecision.requestedReasoningEffort,
      sentReasoningEffort: reasoningDecision.sentReasoningEffort,
      reasoningSuppressedReason: reasoningDecision.reasoningSuppressedReason,
      sdkVersion: runtimeCapabilities.sdkVersion,
      runtimeReasoningSupport: runtimeCapabilities.reasoning,
      runtimeKind: runtimeCapabilities.runtimeKind,
      apiBaseUrl: runtimeCapabilities.apiBaseUrl,
      previousResponseId,
      responseId: response.id ?? null,
      round,
      usage: responseUsage(response),
      toolCount: functionCalls.length,
      assistantPhase: finalMessage?.phase ?? null,
    });

    if (finalMessage?.text && functionCalls.length === 0) {
      return {
        response,
        completion: null,
        toolCalls: toolCallsLog,
        reasoningDecision,
      };
    }

    if (functionCalls.length === 0) {
      const error = abort('no_actionable_output', response.id);
      await logWarn('assistant_no_actionable_output', {
        traceId,
        round,
        responseId: response.id ?? null,
        previousResponseId: previousResponseId ?? null,
        stopReason: error.internalCode,
        usage: responseUsage(response),
      });
      return {
        response,
        completion: null,
        toolCalls: toolCallsLog,
        reasoningDecision,
        error,
      };
    }

    if (totalToolCalls + functionCalls.length > MAX_TOTAL_TOOL_CALLS) {
      const error = abort('tool_budget_exceeded', response.id);
      await logWarn('assistant_tool_budget_exceeded', {
        traceId,
        round,
        responseId: response.id ?? null,
        previousResponseId: previousResponseId ?? null,
        stopReason: error.internalCode,
        totalToolCalls,
        requestedCalls: functionCalls.length,
      });
      return {
        response,
        completion: null,
        toolCalls: toolCallsLog,
        reasoningDecision,
        error,
      };
    }

    let progressThisRound = false;
    const nextInput: OpenAI.Responses.ResponseInputItem[] = [];

    for (const call of functionCalls) {
      const tool = getToolDefinition(call.name, tools);
      if (!tool) {
        toolCallsLog.push({ tool_call_id: call.call_id, name: call.name, ok: false, error: 'unknown_tool' });
        const error = abort('unknown_tool', response.id);
        await logWarn('assistant_unknown_tool', {
          traceId,
          round,
          responseId: response.id ?? null,
          previousResponseId: previousResponseId ?? null,
          tool: call.name,
          call_id: call.call_id,
          resultClass: 'unknown_tool',
          stopReason: error.internalCode,
        });
        return {
          response,
          completion: null,
          toolCalls: toolCallsLog,
          reasoningDecision,
          error,
        };
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
          round,
          responseId: response.id ?? null,
          previousResponseId: previousResponseId ?? null,
          tool: call.name,
          call_id: call.call_id,
          argsParseOk: false,
          resultClass: 'invalid_tool_args_json',
          stopReason: error.internalCode,
        });
        return {
          response,
          completion: null,
          toolCalls: toolCallsLog,
          reasoningDecision,
          error,
        };
      }

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
          round,
          responseId: response.id ?? null,
          previousResponseId: previousResponseId ?? null,
          tool: call.name,
          call_id: call.call_id,
          argsParseOk: true,
          schemaValid: false,
          issues: schemaValidation.issues,
          resultClass: 'invalid_tool_args_schema',
          stopReason: error.internalCode,
        });
        return {
          response,
          completion: null,
          toolCalls: toolCallsLog,
          reasoningDecision,
          error,
        };
      }

      const fingerprint = makeToolFingerprint(call.name, parsed.value, lastToolResultClass);
      if (fingerprint === lastFingerprint) {
        sameFingerprintInRow += 1;
      } else {
        sameFingerprintInRow = 1;
      }
      lastFingerprint = fingerprint;

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
          round,
          responseId: response.id ?? null,
          previousResponseId: previousResponseId ?? null,
          tool: call.name,
          call_id: call.call_id,
          resultClass: lastToolResultClass,
          stopReason: error.internalCode,
          fingerprint,
        });
        return {
          response,
          completion: null,
          toolCalls: toolCallsLog,
          reasoningDecision,
          error,
        };
      }

      const startedAt = Date.now();
      const result = await runToolWithTimeout(call.name, parsed.value, TOOL_TIMEOUT_MS);
      const toolLatencyMs = Date.now() - startedAt;

      if (!result.ok) {
        lastToolResultClass = result.code;
        toolCallsLog.push({
          tool_call_id: call.call_id,
          name: call.name,
          ok: false,
          error: result.code,
        });
        const error = abort(result.code === 'tool_timeout' ? 'tool_timeout' : 'tool_execution_failed', response.id);
        await logWarn('assistant_tool_failed', {
          traceId,
          round,
          responseId: response.id ?? null,
          previousResponseId: previousResponseId ?? null,
          tool: call.name,
          call_id: call.call_id,
          toolLatencyMs,
          resultClass: result.code,
          stopReason: error.internalCode,
          usage: responseUsage(response),
        });
        return {
          response,
          completion: null,
          toolCalls: toolCallsLog,
          reasoningDecision,
          error,
        };
      }

      lastToolResultClass = 'ok';
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
        round,
        responseId: response.id ?? null,
        previousResponseId: previousResponseId ?? null,
        tool: call.name,
        call_id: call.call_id,
        toolLatencyMs,
        resultClass: 'ok',
        usage: responseUsage(response),
      });
    }

    if (!progressThisRound && !finalMessage?.text && sameFingerprintInRow > 0) {
      noProgressRounds += 1;
    } else {
      noProgressRounds = 0;
    }

    if (noProgressRounds >= MAX_NO_PROGRESS_ROUNDS) {
      const error = abort('no_progress_abort', response.id);
      await logWarn('assistant_no_progress_abort', {
        traceId,
        round,
        responseId: response.id ?? null,
        previousResponseId: previousResponseId ?? null,
        stopReason: error.internalCode,
        usage: responseUsage(response),
      });
      return {
        response,
        completion: null,
        toolCalls: toolCallsLog,
        reasoningDecision,
        error,
      };
    }

    pendingInput = nextInput;
  }

  const error = abort('tool_loop_limit', previousResponseId);
  await logWarn('assistant_tool_loop_limit', {
    traceId,
    responseId: previousResponseId ?? null,
    previousResponseId: previousResponseId ?? null,
    stopReason: error.internalCode,
    totalToolCalls,
  });

  return {
    response: lastResponse,
    completion: null,
    toolCalls: toolCallsLog,
    reasoningDecision: lastReasoningDecision,
    error,
  };
}
