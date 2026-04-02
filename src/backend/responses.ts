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
  return (output ?? []).filter(
    (item): item is ResponseOutputItem & {
      type: 'function_call';
      call_id: string;
      name: string;
      arguments: string;
    } => item.type === 'function_call',
  );
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
