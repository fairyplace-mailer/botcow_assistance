import type {
  Response,
  ResponseInput,
  ResponseInputItem,
  ResponseOutputItem,
} from 'openai/resources/responses/responses';

export type AssistantMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: unknown;
  tool_call_id?: string;
  name?: string;
};

type ResponseOutputTextPart = {
  type: 'output_text';
  text: string;
};

type ResponseRefusalPart = {
  type: 'refusal';
};

export type ExtractedFunctionCall = {
  id?: string;
  call_id: string;
  name: string;
  arguments: string;
};

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

function isInputMessageItem(item: ResponseInputItem): boolean {
  return 'role' in item;
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

    const output = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);

    if (typeof output !== 'string') {
      throw new Error(`function_call_output for ${result.call_id} could not be normalized to string`);
    }

    return {
      type: 'function_call_output',
      call_id: result.call_id,
      output,
    } as ResponseInputItem;
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

    if (!isInputMessageItem(item)) {
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

  validateResponsesInput(input);

  const built: {
    instructions?: string;
    input: ResponseInput;
  } = {
    input,
  };

  if (systemInstructions) {
    built.instructions = systemInstructions;
  }

  return built;
}

export function getResponseFunctionCalls(output: ResponseOutputItem[] | undefined) {
  return extractFunctionCalls(output);
}

export function extractResponseText(response: Response | null | undefined): string {
  if (!response) {
    return '';
  }

  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text;
  }

  const output = Array.isArray(response.output) ? response.output : [];

  for (const item of output) {
    if (item?.type !== 'message' || !Array.isArray(item?.content)) {
      continue;
    }

    const text = item.content
      .map((part) => {
        if (hasOutputText(part)) {
          return part.text;
        }

        if (hasRefusal(part)) {
          return '';
        }

        return '';
      })
      .join('')
      .trim();

    if (text) {
      return text;
    }
  }

  return '';
}
