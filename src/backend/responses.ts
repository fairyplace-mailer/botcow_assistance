import type OpenAI from 'openai';
import type {
  Response,
  ResponseCreateParams,
  ResponseInput,
  ResponseInputItem,
  ResponseOutputItem,
} from 'openai/resources/responses/responses';

export type AssistantPhase = 'commentary' | 'final_answer';

export type AssistantMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: unknown;
  tool_call_id?: string;
  name?: string;
  phase?: AssistantPhase;
};

type ResponseOutputTextPart = {
  type: 'output_text';
  text: string;
};

type ResponseRefusalPart = {
  type: 'refusal';
};

type InputTextPart = {
  type: 'input_text';
  text: string;
};

type InputMessageRole = 'user' | 'assistant' | 'system' | 'developer';

type InputMessageItem = {
  type?: 'message';
  role: InputMessageRole;
  content: InputTextPart[];
  phase?: AssistantPhase;
};

export type ExtractedFunctionCall = {
  id?: string | undefined;
  call_id: string;
  name: string;
  arguments: string;
};

export type ExtractedAssistantMessage = {
  id?: string;
  role: 'assistant';
  phase?: AssistantPhase;
  text: string;
};

export type ResponsesStateMode =
  | { kind: 'conversation'; conversation: { id: string } }
  | { kind: 'previous_response'; previousResponseId: string }
  | { kind: 'stateless' };

export type ResponsesCreateRequestParams = {
  model: string;
  instructions?: string;
  input: ResponseInput;
  state?: ResponsesStateMode;
  tools?: OpenAI.Responses.Tool[];
  reasoning?: ResponseCreateParams['reasoning'];
};

export function normalizeTextContent(content: unknown): string {
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

function hasOutputText(part: unknown): part is ResponseOutputTextPart {
  return (
    !!part &&
    typeof part === 'object' &&
    (part as { type?: unknown }).type === 'output_text' &&
    typeof (part as { text?: unknown }).text === 'string'
  );
}

function hasRefusal(part: unknown): part is ResponseRefusalPart {
  return !!part && typeof part === 'object' && (part as { type?: unknown }).type === 'refusal';
}

function isMessageInputItem(item: ResponseInputItem): item is InputMessageItem {
  return (
    !!item &&
    typeof item === 'object' &&
    'role' in item &&
    typeof (item as { role?: unknown }).role === 'string' &&
    'content' in item &&
    Array.isArray((item as { content?: unknown }).content)
  );
}

export function extractFunctionCalls(output: ResponseOutputItem[] | undefined): ExtractedFunctionCall[] {
  const functionCalls = (output ?? []).filter(
    (item): item is ResponseOutputItem & {
      type: 'function_call';
      id?: string;
      call_id: string;
      name: string;
      arguments: string;
    } => item.type === 'function_call',
  );

  const seenCallIds = new Set<string>();

  return functionCalls.map((call) => {
    if (!call.call_id || typeof call.call_id !== 'string') {
      throw new Error('Responses function_call is missing call_id');
    }

    if (seenCallIds.has(call.call_id)) {
      throw new Error(`Duplicate function_call call_id in current response cycle: ${call.call_id}`);
    }

    seenCallIds.add(call.call_id);

    return {
      id: call.id,
      call_id: call.call_id,
      name: call.name,
      arguments: call.arguments,
    };
  });
}

export function extractAssistantMessages(response: Response | null | undefined): ExtractedAssistantMessage[] {
  if (!response || !Array.isArray(response.output)) {
    return [];
  }

  return response.output
    .filter((item: any) => item?.type === 'message' && item?.role === 'assistant')
    .map((item: any) => ({
      id: item.id,
      role: 'assistant' as const,
      phase: item.phase,
      text: Array.isArray(item.content)
        ? item.content
            .filter((part: any) => part?.type === 'output_text')
            .map((part: any) => part.text)
            .join('')
        : '',
    }))
    .filter((item) => item.text.length > 0);
}

export function extractFinalAssistantMessage(
  response: Response | null | undefined,
): ExtractedAssistantMessage | null {
  const items = extractAssistantMessages(response);
  if (!items.length) {
    return null;
  }

  const explicitFinal = items.find((item) => item.phase === 'final_answer');
  if (explicitFinal) {
    return explicitFinal;
  }

  return items[items.length - 1] ?? null;
}

export function extractResponseText(response: Response | null | undefined): string {
  if (!response) {
    return '';
  }

  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text;
  }

  return extractFinalAssistantMessage(response)?.text ?? '';
}

export function extractConversationId(
  response: Pick<Response, 'conversation'> | null | undefined,
  persistedConversationId?: string | null,
): string | null {
  return response?.conversation?.id ?? persistedConversationId ?? null;
}

export function makeFunctionCallOutputItem(callId: string, output: unknown): ResponseInputItem {
  return {
    type: 'function_call_output',
    call_id: callId,
    output: typeof output === 'string' ? output : JSON.stringify(output),
  } as ResponseInputItem;
}

export function buildFunctionCallOutputs(
  functionCalls: ExtractedFunctionCall[],
  toolResults: Array<{ call_id: string; output: unknown }>,
): ResponseInputItem[] {
  const validCallIds = new Set(functionCalls.map((call) => call.call_id));
  const seenCallIds = new Set<string>();

  return toolResults.map((result) => {
    if (!result.call_id) {
      throw new Error('function_call_output is missing call_id');
    }

    if (!validCallIds.has(result.call_id)) {
      throw new Error(`Stale or unknown function_call_output call_id: ${result.call_id}`);
    }

    if (seenCallIds.has(result.call_id)) {
      throw new Error(`Duplicate function_call_output call_id in current response cycle: ${result.call_id}`);
    }

    seenCallIds.add(result.call_id);

    return makeFunctionCallOutputItem(result.call_id, result.output);
  });
}

export function validateResponsesInput(items: ResponseInputItem[]): void {
  for (const item of items) {
    if ('type' in item && item.type === 'function_call_output') {
      if (!item.call_id || typeof item.call_id !== 'string') {
        throw new Error('Responses payload validation failed: function_call_output.call_id must be a non-empty string');
      }

      if (!('output' in item) || item.output === undefined || item.output === null) {
        throw new Error('Responses payload validation failed: function_call_output.output is required');
      }

      continue;
    }

    if (!isMessageInputItem(item)) {
      throw new Error('Responses payload validation failed: unsupported input item shape');
    }

    if (!Array.isArray(item.content) || item.content.length === 0) {
      throw new Error('Responses payload validation failed: input message content must be a non-empty array');
    }

    for (const contentItem of item.content) {
      if (!contentItem || typeof contentItem !== 'object') {
        throw new Error('Responses payload validation failed: content item must be an object');
      }

      if ((contentItem as { type?: unknown }).type !== 'input_text') {
        throw new Error(
          `Responses payload validation failed: unsupported input content type ${(contentItem as { type?: unknown }).type ?? 'unknown'}`,
        );
      }

      if (typeof (contentItem as { text?: unknown }).text !== 'string') {
        throw new Error('Responses payload validation failed: input_text.text must be a string');
      }
    }
  }
}

export function buildResponsesInput(messages: AssistantMessage[]): {
  instructions?: string;
  input: ResponseInput;
} {
  const systemInstructions = messages
    .filter((message) => message.role === 'system')
    .map((message) => normalizeTextContent(message.content))
    .filter(Boolean)
    .join('\n\n');

  const input: ResponseInputItem[] = messages.flatMap((message) => {
    if (message.role === 'system') {
      return [];
    }

    if (message.role === 'tool') {
      return [
        makeFunctionCallOutputItem(
          message.tool_call_id ?? '',
          normalizeTextContent(message.content),
        ),
      ];
    }

    const item: InputMessageItem = {
      type: 'message',
      role: message.role,
      content: [
        {
          type: 'input_text',
          text: normalizeTextContent(message.content),
        },
      ],
    };

    if (message.role === 'assistant' && message.phase) {
      item.phase = message.phase;
    }

    return [item as ResponseInputItem];
  });

  validateResponsesInput(input);

  return {
    ...(systemInstructions ? { instructions: systemInstructions } : {}),
    input,
  };
}

export function getResponseFunctionCalls(output: ResponseOutputItem[] | undefined) {
  return extractFunctionCalls(output);
}

export function buildStrictFunctionTools(tools: OpenAI.Responses.Tool[] | undefined): OpenAI.Responses.Tool[] {
  if (!Array.isArray(tools) || tools.length === 0) {
    return [];
  }

  return tools.map((tool: any) => {
    if (tool?.type === 'function' && tool?.function && typeof tool.function.name === 'string') {
      return {
        type: 'function',
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters ?? {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        strict: true,
      } as OpenAI.Responses.FunctionTool;
    }

    if (tool?.type === 'function' && typeof tool?.name === 'string') {
      return {
        ...tool,
        strict: true,
      } as OpenAI.Responses.FunctionTool;
    }

    return tool;
  });
}

function assertValidResponsesStateMode(state: ResponsesStateMode) {
  if (state.kind === 'conversation' && !state.conversation?.id) {
    throw new Error('Responses state validation failed: conversation.id is required');
  }

  if (state.kind === 'previous_response' && !state.previousResponseId) {
    throw new Error('Responses state validation failed: previousResponseId is required');
  }
}

export function buildResponsesCreateParams(
  params: ResponsesCreateRequestParams,
): ResponseCreateParams {
  const state = params.state ?? { kind: 'stateless' as const };
  assertValidResponsesStateMode(state);

  return {
    model: params.model,
    input: params.input,
    ...(params.instructions !== undefined ? { instructions: params.instructions } : {}),
    ...(state.kind === 'previous_response'
      ? { previous_response_id: state.previousResponseId }
      : {}),
    ...(state.kind === 'conversation' ? { conversation: state.conversation } : {}),
    ...(params.reasoning !== undefined ? { reasoning: params.reasoning } : {}),
    tools: buildStrictFunctionTools(params.tools),
    parallel_tool_calls: false,
  } as ResponseCreateParams;
}

export function responseUsage(response: Response | null | undefined) {
  return {
    inputTokens: response?.usage?.input_tokens ?? null,
    outputTokens: response?.usage?.output_tokens ?? null,
    totalTokens: response?.usage?.total_tokens ?? null,
  };
}

export async function createModelResponse(params: {
  client: OpenAI;
  model: string;
  instructions?: string;
  input: ResponseInput;
  state?: ResponsesStateMode;
  tools?: OpenAI.Responses.Tool[];
  reasoning?: ResponseCreateParams['reasoning'];
}): Promise<Response> {
  const requestParams = {
    model: params.model,
    input: params.input,
    ...(params.instructions !== undefined ? { instructions: params.instructions } : {}),
    ...(params.state !== undefined ? { state: params.state } : {}),
    ...(params.tools !== undefined ? { tools: params.tools } : {}),
    ...(params.reasoning !== undefined ? { reasoning: params.reasoning } : {}),
  } satisfies ResponsesCreateRequestParams;

  return params.client.responses.create(buildResponsesCreateParams(requestParams)) as Promise<Response>;
}
