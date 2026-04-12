import { createHash } from 'crypto';

import type OpenAI from 'openai';
import type { Response } from 'openai/resources/responses/responses';

import { getOpenAIClient } from './openai';
import { formatDevWixContext, retrieveDevWixContext } from './devWixDocs/retrieve';
import { compactAssistantMessages } from './compaction';
import {
  buildStrictFunctionTools,
  createModelResponse,
  extractConversationId,
  extractFinalAssistantMessage,
  extractFunctionCalls,
  responseUsage,
  type ResponsesStateMode,
} from './responses';
import { getToolsSchemas, handleToolCall } from './tools';
import type { ModelRoutingDecision, ReasoningEffort } from './modelRouter';
import { logEvent, logInfo, logWarn } from './log';
import {
  getResponsesRuntimeCapabilities,
  supportsReasoning,
  REASONING_ALLOWED_EFFORTS,
  type ReasoningSuppressedReason,
  type ResponsesRuntimeCapabilities,
} from './openaiRuntime';

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
  text?: { verbosity?: 'low' | 'medium' | 'high' };
  maxOutputTokens?: number;
  reason?: string;
};

export type ConversationStateRef = {
  conversationId?: string;
  previousResponseId?: string;
};

export type RunAssistantTurnParams = {
  instructions: string;
  messages: Array<{ role: string; content: unknown }>;
  tools?: OpenAI.Responses.Tool[];
  routing: AssistantRunOptions;
  state: ConversationStateRef;
};

export type ReasoningDecision = {
  requestedReasoningEffort: ReasoningEffort | null;
  sentReasoningEffort: ReasoningEffort | null;
  reasoningSuppressedReason: ReasoningSuppressedReason | null;
};

export type AssistantResult = {
  response: Response | null;
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
};

const DEFAULT_MAX_TOOL_LOOPS = 12;
const DEFAULT_MAX_TOTAL_TOOL_CALLS = 24;
const DEFAULT_MAX_SAME_FINGERPRINT_IN_ROW = 2;
const DEFAULT_TOOL_TIMEOUT_MS = 20_000;

const AUDIT_MAX_TOOL_LOOPS = 20;
const AUDIT_MAX_TOTAL_TOOL_CALLS = 80;
const AUDIT_MAX_SAME_FINGERPRINT_IN_ROW = 3;
const AUDIT_TOOL_TIMEOUT_MS = 40_000;

const MAX_NO_PROGRESS_ROUNDS = 2;
const OPENAI_RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);
const OPENAI_MAX_ATTEMPTS = 3;

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

  if (!supportsReasoning(routing.model, runtimeCapabilities)) {
    return {
      requestedReasoningEffort,
      sentReasoningEffort: null,
      reasoningSuppressedReason:
        runtimeCapabilities.reasoning === 'unknown' ? 'sdk_contract_unknown' : 'runtime_not_supported',
    };
  }

  return {
    requestedReasoningEffort,
    sentReasoningEffort: requestedReasoningEffort,
    reasoningSuppressedReason: null,
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashArgs(args: unknown): string {
  return sha256(stableStringify(args));
}

function makeToolFingerprint(toolName: string, args: unknown): string {
  return sha256(`${toolName}\n${stableStringify(args)}`);
}

function safeParseToolArgs(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

function normalizeStrictToolArgs(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;

  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeStrictToolArgs(item))
      .filter((item) => item !== undefined);
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const normalized = normalizeStrictToolArgs(item);
      if (normalized !== undefined) out[key] = normalized;
    }
    return out;
  }

  return value;
}

function jsonSchemaTypeOf(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
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
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  return tools.find((tool: any) => tool?.type === 'function' && tool?.name === name) as
    | OpenAI.Responses.FunctionTool
    | undefined;
}

function validateToolArgsAgainstSchema(
  schema: Record<string, unknown> | null | undefined,
  value: unknown,
): { ok: true } | { ok: false; issues: string[] } {
  if (!schema || typeof schema !== 'object') return { ok: true };
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
    if (!(key in objectValue)) issues.push(`missing required field: ${key}`);
  }

  for (const [key, item] of Object.entries(objectValue)) {
    const propSchema = properties[key];
    if (!propSchema) {
      if (additionalProperties === false) issues.push(`unexpected field: ${key}`);
      continue;
    }

    const expectedType = propSchema.type;
    if (typeof expectedType === 'string') {
      const actualType = jsonSchemaTypeOf(item);
      if (expectedType !== actualType) issues.push(`field ${key} must be ${expectedType}`);
      continue;
    }

    if (Array.isArray(expectedType) && expectedType.every((t): t is string => typeof t === 'string')) {
      const actualType = jsonSchemaTypeOf(item);
      if (!expectedType.includes(actualType)) {
        issues.push(`field ${key} must be one of: ${expectedType.join(', ')}`);
      }
    }
  }

  return issues.length ? { ok: false, issues } : { ok: true };
}

function normalizeContentToText(content: unknown): string | null {
  if (!content) return null;

  if (typeof content === 'string') {
    const trimmed = content.trim();
    return trimmed ? trimmed : null;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        if (typeof part === 'object' && part !== null && 'text' in part) {
          return String((part as any).text ?? '');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();

    return text ? text : null;
  }

  if (typeof content === 'object' && content !== null && 'text' in content) {
    const text = String((content as any).text ?? '').trim();
    return text ? text : null;
  }

  return null;
}

function latestUserText(messages: Array<{ role: string; content: unknown }>): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== 'user') continue;
    const text = normalizeContentToText(message.content);
    if (text) return text;
  }
  return null;
}

function shouldRetrieveDevWixContext(query: string | null): boolean {
  if (!query) return false;
  return /(dev\.wix\.com|wix|velo|wix docs|wix sdk)/i.test(query);
}

async function buildContextAugmentedInstructions(params: {
  instructions: string;
  messages: Array<{ role: string; content: unknown }>;
}): Promise<string> {
  const query = latestUserText(params.messages);
  if (!shouldRetrieveDevWixContext(query)) return params.instructions;

  const normalizedQuery = (query ?? '').trim();
  if (!normalizedQuery) return params.instructions;

  try {
    const retrieved = await retrieveDevWixContext({ query: normalizedQuery, topK: 4, maxChars: 5000 });
    const contextBlock = formatDevWixContext(retrieved.chunks);
    if (!contextBlock) return params.instructions;

    return [
      params.instructions,
      '',
      'Use the retrieved Wix docs context below only when it is relevant and sufficient.',
      'Do not claim the docs support something unless the context below actually supports it.',
      contextBlock,
    ].join('\n');
  } catch (error: any) {
    await logWarn('assistant_context_retrieval_failed', {
      error: error?.message ?? String(error),
      finalStatus: 'failed',
    });
    return params.instructions;
  }
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

type AssistantExecutionProfile = {
  mode: 'default' | 'repo_audit';
  instructions: string;
  maxToolLoops: number;
  maxTotalToolCalls: number;
  maxSameFingerprintInRow: number;
  toolTimeoutMs: number;
};

function allMessagesText(messages: Array<{ role: string; content: unknown }>): string {
  return messages
    .map((message) => normalizeContentToText(message?.content) ?? '')
    .filter(Boolean)
    .join('\n');
}

function looksLikeRepoAuditRequest(text: string): boolean {
  if (!text) return false;

  const hasAuditIntent =
    /\b(full audit|audit code|audit the code|audit codebase|repo audit|spec audit|strict mode|responses api)\b/i.test(
      text,
    ) || /полный аудит|сделать аудит|аудит кода|соответствие|строгий режим|репо|ветк|strong_spec/i.test(text);

  const hasRepoScope =
    /docs\/strong_spec\.md|strong_spec|repo|repository|branch|ветк|репо|strict mode|responses api/i.test(text);

  return hasAuditIntent && hasRepoScope;
}

function buildExecutionProfile(params: Pick<RunAssistantTurnParams, 'instructions' | 'messages'>): AssistantExecutionProfile {
  const detectionText = `${params.instructions}\n${allMessagesText(params.messages)}`;

  if (!looksLikeRepoAuditRequest(detectionText)) {
    return {
      mode: 'default',
      instructions: params.instructions,
      maxToolLoops: DEFAULT_MAX_TOOL_LOOPS,
      maxTotalToolCalls: DEFAULT_MAX_TOTAL_TOOL_CALLS,
      maxSameFingerprintInRow: DEFAULT_MAX_SAME_FINGERPRINT_IN_ROW,
      toolTimeoutMs: DEFAULT_TOOL_TIMEOUT_MS,
    };
  }

  const auditSuffix = `
Repository audit mode:
- This is a repo-wide read-only audit task.
- Do not modify files, do not commit, do not deploy.
- Prefer broad repo inspection before conclusions.
- Prefer reading files in batches with github_get_files_batch when available.
- Focus on exact compliance against docs/strong_spec.md.
- In the final answer, report only mismatches, partial mismatches, and whether Responses API strict mode is configured.
- Keep the answer short, direct, and in simple language.
`.trim();

  return {
    mode: 'repo_audit',
    instructions: `${params.instructions}\n\n${auditSuffix}`,
    maxToolLoops: AUDIT_MAX_TOOL_LOOPS,
    maxTotalToolCalls: AUDIT_MAX_TOTAL_TOOL_CALLS,
    maxSameFingerprintInRow: AUDIT_MAX_SAME_FINGERPRINT_IN_ROW,
    toolTimeoutMs: AUDIT_TOOL_TIMEOUT_MS,
  };
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
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function selectResponsesStateMode(params: {
  conversationId?: string;
  previousResponseId?: string;
}): ResponsesStateMode {
  if (params.conversationId) {
    return { kind: 'conversation', conversation: { id: params.conversationId } };
  }

  if (params.previousResponseId) {
    return { kind: 'previous_response', previousResponseId: params.previousResponseId };
  }

  return { kind: 'stateless' };
}

function payloadKeysForStateMode(stateMode: ResponsesStateMode): string[] {
  if (stateMode.kind === 'conversation') return ['conversation'];
  if (stateMode.kind === 'previous_response') return ['previous_response_id'];
  return [];
}

async function logFatalStop(event: string, payload: Parameters<typeof logWarn>[1]) {
  await logWarn(event, { ...payload, finalStatus: 'failed' });
}

function buildFailureState(conversationId: string | null, responseId?: string | null) {
  return {
    conversationId,
    latestResponseId: responseId ?? null,
  };
}

function isRetryableOpenAIError(error: any): boolean {
  const status = error?.status ?? error?.statusCode ?? error?.cause?.status;
  if (typeof status === 'number' && OPENAI_RETRYABLE_STATUS.has(status)) return true;

  const code = String(error?.code ?? error?.cause?.code ?? '').toLowerCase();
  return code === 'etimedout' || code === 'econnreset' || code === 'eai_again';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createModelResponseWithRetry(params: Parameters<typeof createModelResponse>[0]) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= OPENAI_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await createModelResponse(params);
    } catch (error) {
      lastError = error;
      if (attempt >= OPENAI_MAX_ATTEMPTS || !isRetryableOpenAIError(error)) {
        throw error;
      }
      await delay(300 * attempt);
    }
  }

  throw lastError;
}

export async function runAssistant(params: RunAssistantTurnParams): Promise<AssistantResult> {
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
    instructions: params.instructions,
    messages: requestMessages,
  });

  const effectiveInstructions = await buildContextAugmentedInstructions({
    instructions: executionProfile.instructions,
    messages: requestMessages,
  });

  let pendingInput = normalizeMessagesToInput(requestMessages);
  let previousResponseId: string | undefined = params.state.previousResponseId;
  let currentConversationId: string | null = params.state.conversationId ?? null;
  let totalToolCalls = 0;
  let noProgressRounds = 0;
  let lastFingerprint: string | null = null;
  let sameFingerprintInRow = 0;

  const openai = getOpenAIClient();
  const tools = buildStrictFunctionTools(params.tools ?? getToolsSchemas() ?? []);

  for (let round = 1; round <= executionProfile.maxToolLoops; round += 1) {
    const runtimeCapabilities = getResponsesRuntimeCapabilities();
    const reasoningDecision = resolveReasoningDecision(params.routing, runtimeCapabilities);
    lastReasoningDecision = reasoningDecision;

    const stateMode = selectResponsesStateMode({
      ...(currentConversationId ? { conversationId: currentConversationId } : {}),
      ...(previousResponseId ? { previousResponseId } : {}),
    });

    const requestPreviousResponseId =
      stateMode.kind === 'previous_response' ? stateMode.previousResponseId : undefined;
    const requestConversationId =
      stateMode.kind === 'conversation' ? stateMode.conversation.id : currentConversationId;

    await logInfo('assistant_round_started', {
      traceId,
      userTurnId,
      round,
      conversationId: requestConversationId,
      previousResponseId: requestPreviousResponseId ?? null,
      totalToolCalls,
      model: params.routing.model,
      modelReason: params.routing.reason,
      reasoningEffort: reasoningDecision.sentReasoningEffort,
      assistantMode: executionProfile.mode,
      finalStatus: 'in_progress',
      duration: Date.now() - startedAt,
    });

    const response = await createModelResponseWithRetry({
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
    });

    lastResponse = response;
    previousResponseId = response.id;
    currentConversationId = extractConversationId(response, currentConversationId);

    const functionCalls = extractFunctionCalls((response as any).output);
    const finalMessage = extractFinalAssistantMessage(response);

    await logInfo('assistant_round_completed', {
      traceId,
      userTurnId,
      round,
      conversationId: currentConversationId,
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
      finalStatus: finalMessage?.text && functionCalls.length === 0 ? 'completed' : 'in_progress',
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
      conversationId: currentConversationId,
      previousResponseId: requestPreviousResponseId ?? null,
      responseId: response.id ?? null,
      round,
      duration: Date.now() - startedAt,
      usage: responseUsage(response),
      toolCount: functionCalls.length,
      assistantMode: executionProfile.mode,
      assistantPhase: finalMessage?.phase ?? null,
      finalStatus: 'in_progress',
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

    if (finalMessage?.text && functionCalls.length === 0) {
      await logInfo('assistant_run_completed', {
        traceId,
        userTurnId,
        conversationId: currentConversationId,
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
          conversationId: currentConversationId,
          latestResponseId: response.id ?? null,
        },
      };
    }

    if (functionCalls.length === 0) {
      const error = abort('no_actionable_output', response.id);
      await logFatalStop('assistant_run_failed', {
        traceId,
        userTurnId,
        round,
        conversationId: currentConversationId,
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
        state: buildFailureState(currentConversationId, response.id),
        error,
      };
    }

    if (totalToolCalls + functionCalls.length > executionProfile.maxTotalToolCalls) {
      const error = abort('tool_budget_exceeded', response.id);
      await logFatalStop('assistant_run_failed', {
        traceId,
        userTurnId,
        round,
        conversationId: currentConversationId,
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
        state: buildFailureState(currentConversationId, response.id),
        error,
      };
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
        await logFatalStop('assistant_run_failed', {
          traceId,
          userTurnId,
          round,
          conversationId: currentConversationId,
          responseId: response.id ?? null,
          previousResponseId: requestPreviousResponseId ?? null,
          toolName: call.name,
          toolCallId: call.call_id,
          toolResultClass: 'unknown_tool',
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
          state: buildFailureState(currentConversationId, response.id),
          error,
        };
      }

      const parsed = safeParseToolArgs(call.arguments);
      if (!parsed.ok) {
        toolCallsLog.push({ tool_call_id: call.call_id, name: call.name, ok: false, error: 'invalid_tool_args_json' });
        const error = abort('invalid_tool_args_json', response.id);
        await logFatalStop('assistant_run_failed', {
          traceId,
          userTurnId,
          round,
          conversationId: currentConversationId,
          responseId: response.id ?? null,
          previousResponseId: requestPreviousResponseId ?? null,
          toolName: call.name,
          toolCallId: call.call_id,
          argsParseOk: false,
          toolResultClass: 'invalid_tool_args_json',
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
          state: buildFailureState(currentConversationId, response.id),
          error,
        };
      }

      const schemaValidation = validateToolArgsAgainstSchema(
        (tool.parameters as Record<string, unknown> | null | undefined) ?? null,
        parsed.value,
      );

      const normalizedArgs =
        (normalizeStrictToolArgs(parsed.value) as Record<string, unknown> | undefined) ?? {};
      const argsHash = hashArgs(normalizedArgs);

      if (!schemaValidation.ok) {
        toolCallsLog.push({ tool_call_id: call.call_id, name: call.name, ok: false, error: 'invalid_tool_args_schema' });
        const error = abort('invalid_tool_args_schema', response.id);
        await logFatalStop('assistant_run_failed', {
          traceId,
          userTurnId,
          round,
          conversationId: currentConversationId,
          responseId: response.id ?? null,
          previousResponseId: requestPreviousResponseId ?? null,
          toolName: call.name,
          toolCallId: call.call_id,
          argsHash,
          argsParseOk: true,
          schemaValid: false,
          toolResultClass: 'invalid_tool_args_schema',
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
          state: buildFailureState(currentConversationId, response.id),
          error,
        };
      }

      const fingerprint = makeToolFingerprint(call.name, normalizedArgs);
      roundFingerprints.push(fingerprint);

      if (fingerprint === lastFingerprint) sameFingerprintInRow += 1;
      else sameFingerprintInRow = 1;

      if (sameFingerprintInRow >= executionProfile.maxSameFingerprintInRow) {
        toolCallsLog.push({ tool_call_id: call.call_id, name: call.name, ok: false, error: 'repeated_tool_call' });
        const error = abort('repeated_tool_call', response.id);
        await logFatalStop('assistant_run_failed', {
          traceId,
          userTurnId,
          round,
          conversationId: currentConversationId,
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
          state: buildFailureState(currentConversationId, response.id),
          error,
        };
      }

      const startedToolAt = Date.now();
      const result = await runToolWithTimeout(call.name, normalizedArgs, executionProfile.toolTimeoutMs);
      const toolLatencyMs = Date.now() - startedToolAt;

      if (result.ok === false) {
        lastFingerprint = fingerprint;
        toolCallsLog.push({ tool_call_id: call.call_id, name: call.name, ok: false, error: result.code });
        const error = abort(result.code === 'tool_timeout' ? 'tool_timeout' : 'tool_execution_failed', response.id);
        await logFatalStop('assistant_run_failed', {
          traceId,
          userTurnId,
          round,
          conversationId: currentConversationId,
          responseId: response.id ?? null,
          previousResponseId: requestPreviousResponseId ?? null,
          toolName: call.name,
          toolCallId: call.call_id,
          argsHash,
          argsParseOk: true,
          schemaValid: true,
          toolLatencyMs,
          toolResultClass: result.code,
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
          state: buildFailureState(currentConversationId, response.id),
          error,
        };
      }

      lastFingerprint = fingerprint;
      totalToolCalls += 1;
      progressThisRound = true;
      toolCallsLog.push({ tool_call_id: call.call_id, name: call.name, ok: true });
      nextInput.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(result.output),
      });

      await logInfo('assistant_tool_succeeded', {
        traceId,
        userTurnId,
        round,
        conversationId: currentConversationId,
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

    const roundFingerprint = roundFingerprints.length ? roundFingerprints.join('|') : null;
    const fingerprintChanged = roundFingerprint !== previousFingerprintBeforeRound;

    if (!progressThisRound && !finalMessage?.text && !fingerprintChanged) noProgressRounds += 1;
    else noProgressRounds = 0;

    if (noProgressRounds >= MAX_NO_PROGRESS_ROUNDS) {
      const error = abort('no_progress_abort', response.id);
      await logFatalStop('assistant_run_failed', {
        traceId,
        userTurnId,
        round,
        conversationId: currentConversationId,
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
        state: buildFailureState(currentConversationId, response.id),
        error,
      };
    }

    pendingInput = nextInput;
  }

  const error = abort('tool_loop_limit', lastResponse?.id);
  await logFatalStop('assistant_run_failed', {
    traceId,
    userTurnId,
    conversationId: currentConversationId,
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
    state: buildFailureState(currentConversationId, previousResponseId),
    error,
  };
}
