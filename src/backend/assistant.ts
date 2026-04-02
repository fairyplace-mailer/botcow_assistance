import { getOpenAIClient } from './openai';
import { getToolsSchemas, handleToolCall } from './tools';
import type { ModelId, ModelRoutingDecision, ReasoningEffort } from './modelRouter';
import type OpenAI from 'openai';
import type {
  Response,
  ResponseInput,
  ResponseInputItem,
  ResponseOutputItem,
} from 'openai/resources/responses/responses';

/**
 * Сообщение для ассистента.
 */
type AssistantMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: unknown;
  tool_call_id?: string;
  name?: string;
};

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
}

export type ReasoningDecision = {
  requestedReasoningEffort: ReasoningEffort | null;
  sentReasoningEffort: ReasoningEffort | null;
  reasoningSuppressedReason: 'model_not_supported' | 'runtime_not_supported' | 'sdk_contract_unknown' | null;
};

const REASONING_CAPABLE_MODELS: ReadonlySet<ModelId> = new Set(['gpt-5.4']);
const REASONING_ALLOWED_EFFORTS: Readonly<Record<ModelId, ReadonlySet<ReasoningEffort>>> = {
  'gpt-5.4': new Set(['low', 'medium', 'high', 'xhigh']),
  'gpt-5.4-mini': new Set(),
  'gpt-5.4-nano': new Set(),
};

function normalizeTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }

        if (
          item &&
          typeof item === 'object' &&
          'type' in item &&
          (item as { type?: unknown }).type === 'text' &&
          'text' in item
        ) {
          return String((item as { text?: unknown }).text ?? '');
        }

        return '';
      })
      .join('\n')
      .trim();
  }

  return '';
}

function buildResponsesInput(messages: AssistantMessage[]): {
  instructions?: string;
  input: ResponseInput;
} {
  const systemInstructions = messages
    .filter((message) => message.role === 'system')
    .map((message) => normalizeTextContent(message.content))
    .filter(Boolean)
    .join('\n\n');

  const input: ResponseInputItem[] = messages
    .filter((message) => message.role !== 'system')
    .map((message) => {
      if (message.role === 'tool') {
        return {
          type: 'function_call_output',
          call_id: message.tool_call_id ?? '',
          output: normalizeTextContent(message.content),
        } as ResponseInputItem;
      }

      return {
        role: message.role,
        content: [
          {
            type: 'input_text',
            text: normalizeTextContent(message.content),
          },
        ],
      } as ResponseInputItem;
    });

  return {
    instructions: systemInstructions || undefined,
    input,
  };
}

function getResponseFunctionCalls(output: ResponseOutputItem[] | undefined) {
  return (output ?? []).filter(
    (item): item is ResponseOutputItem & {
      type: 'function_call';
      call_id: string;
      name: string;
      arguments: string;
    } => item.type === 'function_call',
  );
}

function supportsReasoning(model: ModelId): boolean {
  return REASONING_CAPABLE_MODELS.has(model);
}

function resolveReasoningDecision(
  routing: Pick<ModelRoutingDecision, 'model' | 'reasoning'>,
): ReasoningDecision {
  const requestedReasoningEffort = routing.reasoning?.effort ?? null;

  if (!requestedReasoningEffort) {
    return {
      requestedReasoningEffort,
      sentReasoningEffort: null,
      reasoningSuppressedReason: null,
    };
  }

  if (!supportsReasoning(routing.model)) {
    return {
      requestedReasoningEffort,
      sentReasoningEffort: null,
      reasoningSuppressedReason: 'model_not_supported',
    };
  }

  const allowedEfforts = REASONING_ALLOWED_EFFORTS[routing.model];

  if (!allowedEfforts?.has(requestedReasoningEffort)) {
    return {
      requestedReasoningEffort,
      sentReasoningEffort: null,
      reasoningSuppressedReason: 'sdk_contract_unknown',
    };
  }

  return {
    requestedReasoningEffort,
    sentReasoningEffort: requestedReasoningEffort,
    reasoningSuppressedReason: null,
  };
}

export function buildResponsesRequest(
  messages: AssistantMessage[],
  routing: Pick<ModelRoutingDecision, 'model' | 'reasoning'>,
): {
  request: OpenAI.Responses.ResponseCreateParams;
  reasoningDecision: ReasoningDecision;
} {
  const built = buildResponsesInput(messages);
  const reasoningDecision = resolveReasoningDecision(routing);

  const request: OpenAI.Responses.ResponseCreateParams = {
    model: routing.model,
    input: built.input,
    tools: getToolsSchemas() as OpenAI.Responses.Tool[],
  };

  if (built.instructions) {
    request.instructions = built.instructions;
  }

  if (reasoningDecision.sentReasoningEffort) {
    request.reasoning = { effort: reasoningDecision.sentReasoningEffort };
  }

  return { request, reasoningDecision };
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

  const openai = getOpenAIClient();

  for (let i = 0; i < maxToolLoops; i += 1) {
    const { request } = buildResponsesRequest(messages, routing);
    const response = await openai.responses.create(request);

    lastResponse = response;

    const functionCalls = getResponseFunctionCalls(response.output);

    if (functionCalls.length === 0) {
      return { response, completion: null, toolCalls: toolCallsLog };
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

  if (lastResponse) {
    return { response: lastResponse, completion: null, toolCalls: toolCallsLog };
  }

  return { response: null, completion: null, toolCalls: toolCallsLog };
}
