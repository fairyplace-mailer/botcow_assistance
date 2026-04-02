import { getOpenAIClient } from './openai';
import { getToolsSchemas, handleToolCall } from './tools';
import type { ModelId, ModelRoutingDecision, ReasoningEffort } from './modelRouter';
import type OpenAI from 'openai';
import type { Response } from 'openai/resources/responses/responses';
import {
  buildResponsesInput,
  getResponseFunctionCalls,
  type AssistantMessage,
} from './responses';
import { logEvent } from './log';

/**
 * Результат работы ассистента с tool calls.
 */
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
}

export type ReasoningSuppressedReason =
  | 'model_not_supported'
  | 'runtime_not_supported'
  | 'sdk_contract_unknown';

export type ReasoningDecision = {
  requestedReasoningEffort: ReasoningEffort | null;
  sentReasoningEffort: ReasoningEffort | null;
  reasoningSuppressedReason: ReasoningSuppressedReason | null;
};

export type ResponsesRuntimeCapabilities = {
  path: 'openai.responses.create';
  reasoning: 'supported' | 'unsupported' | 'unknown';
  sdkVersion: string | null;
};

const RESPONSES_RUNTIME_CAPABILITIES: ResponsesRuntimeCapabilities = {
  path: 'openai.responses.create',
  reasoning: 'unknown',
  sdkVersion: '6.16.0',
};

const REASONING_ALLOWED_EFFORTS: Readonly<Record<ModelId, ReadonlySet<ReasoningEffort>>> = {
  'gpt-5.4': new Set(['low', 'medium', 'high', 'xhigh']),
  'gpt-5.4-mini': new Set(),
  'gpt-5.4-nano': new Set(),
};

export function getResponsesRuntimeCapabilities(): ResponsesRuntimeCapabilities {
  return RESPONSES_RUNTIME_CAPABILITIES;
}

export function supportsReasoning(
  model: ModelId,
  runtimeCapabilities: ResponsesRuntimeCapabilities,
): boolean {
  if (runtimeCapabilities.path !== 'openai.responses.create') {
    return false;
  }

  if (runtimeCapabilities.reasoning !== 'supported') {
    return false;
  }

  return (REASONING_ALLOWED_EFFORTS[model]?.size ?? 0) > 0;
}

export function resolveReasoningDecision(
  routing: Pick<ModelRoutingDecision, 'model' | 'reasoning'>,
  runtimeCapabilities: ResponsesRuntimeCapabilities,
): ReasoningDecision {
  const requestedReasoningEffort = routing.reasoning?.effort ?? null;

  if (!requestedReasoningEffort || requestedReasoningEffort === 'none') {
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

type LegacyToolSchema = {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

function isLegacyToolSchema(tool: unknown): tool is LegacyToolSchema {
  if (!tool || typeof tool !== 'object') {
    return false;
  }

  const maybeTool = tool as Record<string, unknown>;
  const maybeFunction = maybeTool.function;

  return (
    maybeTool.type === 'function' &&
    !!maybeFunction &&
    typeof maybeFunction === 'object' &&
    typeof (maybeFunction as Record<string, unknown>).name === 'string'
  );
}

function toResponseTools(tools: ReturnType<typeof getToolsSchemas> | undefined): OpenAI.Responses.Tool[] {
  if (!Array.isArray(tools) || tools.length === 0) {
    return [];
  }

  return tools.map((tool) => {
    if (isLegacyToolSchema(tool)) {
      const normalized: OpenAI.Responses.FunctionTool = {
        type: 'function',
        name: tool.function.name,
        parameters: tool.function.parameters ?? null,
        strict: false,
      };

      if (tool.function.description !== undefined) {
        normalized.description = tool.function.description;
      }

      return normalized;
    }

    return tool as OpenAI.Responses.Tool;
  });
}

export function buildResponsesRequest(
  messages: AssistantMessage[],
  routing: Pick<ModelRoutingDecision, 'model' | 'reasoning'>,
  runtimeCapabilities: ResponsesRuntimeCapabilities = getResponsesRuntimeCapabilities(),
): {
  request: OpenAI.Responses.ResponseCreateParams;
  reasoningDecision: ReasoningDecision;
  runtimeCapabilities: ResponsesRuntimeCapabilities;
} {
  const built = buildResponsesInput(messages);
  const reasoningDecision = resolveReasoningDecision(routing, runtimeCapabilities);

  const request: OpenAI.Responses.ResponseCreateParams = {
    model: routing.model,
    input: built.input,
    tools: toResponseTools(getToolsSchemas()),
  };

  if (built.instructions) {
    request.instructions = built.instructions;
  }

  if (reasoningDecision.sentReasoningEffort) {
    request.reasoning = { effort: reasoningDecision.sentReasoningEffort };
  }

  return { request, reasoningDecision, runtimeCapabilities };
}

/**
 * Ассистент с поддержкой tools (GitHub + Vercel).
 */
export async function runAssistant(
  rawMessages: AssistantMessage[],
  routing: Pick<ModelRoutingDecision, 'model' | 'reasoning'>,
): Promise<AssistantResult> {
  const maxToolLoops = 10;

  let messages: AssistantMessage[] = rawMessages.slice();
  const toolCallsLog: AssistantResult['toolCalls'] = [];
  let lastResponse: Response | null = null;
  let lastReasoningDecision: ReasoningDecision = {
    requestedReasoningEffort: routing.reasoning?.effort ?? null,
    sentReasoningEffort: null,
    reasoningSuppressedReason: null,
  };

  const openai = getOpenAIClient();

  for (let i = 0; i < maxToolLoops; i += 1) {
    const { request, reasoningDecision, runtimeCapabilities } = buildResponsesRequest(messages, routing);
    lastReasoningDecision = reasoningDecision;

    await logEvent('openai-request', {
      path: runtimeCapabilities.path,
      methodWrapper: runtimeCapabilities.path,
      model: request.model,
      requestedReasoningEffort: reasoningDecision.requestedReasoningEffort,
      sentReasoningEffort: reasoningDecision.sentReasoningEffort,
      reasoningSuppressedReason: reasoningDecision.reasoningSuppressedReason,
      payloadKeys: Object.keys(request).sort(),
      sdkVersion: runtimeCapabilities.sdkVersion,
      runtimeReasoningSupport: runtimeCapabilities.reasoning,
    });

    const response = await openai.responses.create(request);

    lastResponse = response;

    const functionCalls = getResponseFunctionCalls(response.output);

    if (functionCalls.length === 0) {
      return {
        response,
        completion: null,
        toolCalls: toolCallsLog,
        reasoningDecision,
      };
    }

    const toolResultMessages: AssistantMessage[] = [];

    for (const call of functionCalls) {
      const name = call.name ?? '';
      const tool_call_id = call.call_id;
      const rawArgs = call.arguments ?? '{}';

      let args: unknown;
      try {
        args = JSON.parse(rawArgs);
      } catch {
        args = {};
      }

      try {
        const result = await handleToolCall(name, args as unknown);

        toolCallsLog.push({ tool_call_id, name, ok: true });

        toolResultMessages.push({
          role: 'tool',
          tool_call_id,
          name,
          content: JSON.stringify(result),
        });
      } catch (error) {
        const err = error as Error;
        const msg = err.message || String(error);

        toolCallsLog.push({
          tool_call_id,
          name,
          ok: false,
          error: msg,
        });

        toolResultMessages.push({
          role: 'tool',
          tool_call_id,
          name,
          content: JSON.stringify({ error: msg }),
        });
      }
    }

    messages = [...messages, ...toolResultMessages];
  }

  return {
    response: lastResponse,
    completion: null,
    toolCalls: toolCallsLog,
    reasoningDecision: lastReasoningDecision,
  };
}
