import { getOpenAIClient } from './openai';
import { getToolsSchemas, handleToolCall } from './tools';
import type { ModelId, ModelRoutingDecision, ReasoningEffort } from './modelRouter';
import type OpenAI from 'openai';
import type {
  Response,
  ResponseInputItem,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses';
import type { Stream } from 'openai/streaming';
import {
  buildFunctionCallOutputs,
  buildResponsesInput,
  getResponseFunctionCalls,
  validateResponsesInput,
  type AssistantMessage,
} from './responses';
import { logEvent } from './log';

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

function isResponseResult(
  value: Response | Stream<ResponseStreamEvent>,
): value is Response {
  return !!value && typeof value === 'object' && 'output' in value;
}

function debugLog(type: string, payload: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'production') {
    return Promise.resolve();
  }

  return logEvent(type, payload);
}

function buildNextToolInput(
  functionCalls: ReturnType<typeof getResponseFunctionCalls>,
  toolResults: Array<{ call_id: string; output: unknown }>,
): ResponseInputItem[] {
  const nextInput = buildFunctionCallOutputs(functionCalls, toolResults);
  validateResponsesInput(nextInput);
  return nextInput;
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

export async function runAssistant(
  rawMessages: AssistantMessage[],
  routing: Pick<ModelRoutingDecision, 'model' | 'reasoning'>,
): Promise<AssistantResult> {
  const maxToolLoops = 10;

  const built = buildResponsesInput(rawMessages);
  let currentInput: OpenAI.Responses.ResponseInput = built.input;
  const instructions = built.instructions;
  const toolCallsLog: AssistantResult['toolCalls'] = [];
  let lastResponse: Response | null = null;
  let lastReasoningDecision: ReasoningDecision = {
    requestedReasoningEffort: routing.reasoning?.effort ?? null,
    sentReasoningEffort: null,
    reasoningSuppressedReason: null,
  };

  const openai = getOpenAIClient();

  for (let i = 0; i < maxToolLoops; i += 1) {
    const reasoningDecision = resolveReasoningDecision(routing, getResponsesRuntimeCapabilities());
    lastReasoningDecision = reasoningDecision;

    const request: OpenAI.Responses.ResponseCreateParams = {
      model: routing.model,
      input: currentInput,
      tools: toResponseTools(getToolsSchemas()),
    };

    if (instructions) {
      request.instructions = instructions;
    }

    if (lastResponse?.id) {
      request.previous_response_id = lastResponse.id;
    }

    if (reasoningDecision.sentReasoningEffort) {
      request.reasoning = { effort: reasoningDecision.sentReasoningEffort };
    }

    await logEvent('openai-request', {
      path: 'openai.responses.create',
      methodWrapper: 'openai.responses.create',
      model: request.model,
      requestedReasoningEffort: reasoningDecision.requestedReasoningEffort,
      sentReasoningEffort: reasoningDecision.sentReasoningEffort,
      reasoningSuppressedReason: reasoningDecision.reasoningSuppressedReason,
      payloadKeys: Object.keys(request).sort(),
      sdkVersion: getResponsesRuntimeCapabilities().sdkVersion,
      runtimeReasoningSupport: getResponsesRuntimeCapabilities().reasoning,
      previous_response_id: request.previous_response_id ?? null,
    });

    const response = await openai.responses.create(request);

    if (!isResponseResult(response)) {
      throw new Error('Streaming Responses API is not supported in assistant runtime');
    }

    lastResponse = response;

    const functionCalls = getResponseFunctionCalls(response.output);

    await debugLog('responses-tool-loop', {
      response_id: response.id ?? null,
      toolLoopRound: i + 1,
      toolCallCount: functionCalls.length,
      functionCalls: functionCalls.map((call) => ({
        id: call.id ?? null,
        call_id: call.call_id,
        name: call.name,
        arguments: call.arguments,
      })),
      responseOutput: response.output,
    });

    if (functionCalls.length === 0) {
      return {
        response,
        completion: null,
        toolCalls: toolCallsLog,
        reasoningDecision,
      };
    }

    const toolResults: Array<{ call_id: string; output: unknown }> = [];

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
        toolResults.push({ call_id: tool_call_id, output: result });
      } catch (error) {
        const err = error as Error;
        const msg = err.message || String(error);

        toolCallsLog.push({
          tool_call_id,
          name,
          ok: false,
          error: msg,
        });

        toolResults.push({
          call_id: tool_call_id,
          output: { error: msg },
        });
      }
    }

    const nextInput = buildNextToolInput(functionCalls, toolResults);

    await debugLog('responses-tool-loop-next-input', {
      response_id: response.id ?? null,
      toolLoopRound: i + 1,
      toolCallCount: functionCalls.length,
      functionCallOutputCallIds: nextInput.map((item) =>
        'call_id' in item ? item.call_id : null,
      ),
      nextInput,
      previous_response_id: response.id ?? null,
    });

    currentInput = nextInput;
  }

  return {
    response: lastResponse,
    completion: null,
    toolCalls: toolCallsLog,
    reasoningDecision: lastReasoningDecision,
  };
}
