import type OpenAI from 'openai';
import type { Response } from 'openai/resources/responses/responses';

import type { PublicChatError, PublicChatSuccess, PublicResponsePhase } from './contracts/chat';
import type { ModelRoutingDecision } from './modelRouter';

export type ResponsesStateMode =
  | { kind: 'stateless' }
  | { kind: 'previous_response'; previousResponseId: string };

export type ExtractedFunctionCall = {
  call_id: string;
  name: string;
  arguments: string;
};

export type FinalAssistantMessage = {
  text: string;
  phase: PublicResponsePhase;
};

const UNSUPPORTED_STRICT_SCHEMA_KEYS = new Set([
  'minItems',
  'maxItems',
  'allOf',
  'not',
  'dependentRequired',
  'dependentSchemas',
  'if',
  'then',
  'else',
]);

function collectUnsupportedStrictSchemaKeys(value: unknown, path = '$'): string[] {
  if (!value || typeof value !== 'object') return [];

  const hits: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (UNSUPPORTED_STRICT_SCHEMA_KEYS.has(key)) {
      hits.push(childPath);
    }
    hits.push(...collectUnsupportedStrictSchemaKeys(child, childPath));
  }

  return hits;
}

function schemaTypeIncludes(schema: unknown, expected: string): boolean {
  const typeValue = (schema as any)?.type;
  if (typeValue === expected) return true;
  if (Array.isArray(typeValue)) return typeValue.includes(expected);
  return false;
}

function validateStrictObjectSchema(
  schema: unknown,
  toolName: string,
  path: string,
  issues: string[],
) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return;

  const anySchema = schema as Record<string, unknown>;
  const isObjectSchema = schemaTypeIncludes(anySchema, 'object');

  if (isObjectSchema) {
    if ((anySchema as any).additionalProperties !== false) {
      issues.push(`${toolName}: object schema at ${path} must set additionalProperties=false`);
    }

    const properties =
      anySchema.properties && typeof anySchema.properties === 'object' && !Array.isArray(anySchema.properties)
        ? (anySchema.properties as Record<string, unknown>)
        : {};

    const propertyKeys = Object.keys(properties);
    const required = Array.isArray((anySchema as any).required)
      ? ((anySchema as any).required as unknown[]).filter((item): item is string => typeof item === 'string')
      : [];

    for (const key of propertyKeys) {
      if (!required.includes(key)) {
        issues.push(`${toolName}: object schema at ${path} must require property ${key}`);
      }
    }

    for (const key of required) {
      if (!propertyKeys.includes(key)) {
        issues.push(`${toolName}: object schema at ${path} has unknown required property ${key}`);
      }
    }
  }

  if (anySchema.properties && typeof anySchema.properties === 'object' && !Array.isArray(anySchema.properties)) {
    for (const [key, child] of Object.entries(anySchema.properties as Record<string, unknown>)) {
      validateStrictObjectSchema(child, toolName, `${path}.properties.${key}`, issues);
    }
  }

  if (anySchema.items) {
    validateStrictObjectSchema(anySchema.items, toolName, `${path}.items`, issues);
  }

  if (Array.isArray((anySchema as any).anyOf)) {
    for (const [index, child] of ((anySchema as any).anyOf as unknown[]).entries()) {
      validateStrictObjectSchema(child, toolName, `${path}.anyOf[${index}]`, issues);
    }
  }

  if (Array.isArray((anySchema as any).oneOf)) {
    for (const [index, child] of ((anySchema as any).oneOf as unknown[]).entries()) {
      validateStrictObjectSchema(child, toolName, `${path}.oneOf[${index}]`, issues);
    }
  }
}

export function buildStrictFunctionTools(
  tools: OpenAI.Responses.Tool[],
): OpenAI.Responses.Tool[] {
  return tools.map((inputTool: any) => {
    if (inputTool?.type !== 'function') return inputTool;

    const tool =
      inputTool?.function && typeof inputTool.function === 'object'
        ? {
            type: 'function',
            name: inputTool.function.name,
            description: inputTool.function.description,
            parameters: inputTool.function.parameters,
            strict: inputTool.function.strict,
          }
        : inputTool;

    const normalizedParameters =
      tool.parameters && typeof tool.parameters === 'object'
        ? tool.parameters
        : { type: 'object', properties: {}, additionalProperties: false };

    return {
      ...tool,
      strict: tool.strict ?? true,
      parameters: normalizedParameters,
    };
  });
}

export function validateResponsesToolsContract(
  tools: OpenAI.Responses.Tool[],
): { ok: true } | { ok: false; issues: string[] } {
  const issues: string[] = [];

  for (const [index, tool] of tools.entries()) {
    const anyTool = tool as any;
    if (anyTool?.type !== 'function') continue;

    const toolName =
      typeof anyTool?.name === 'string' && anyTool.name.trim()
        ? anyTool.name.trim()
        : `tool[${index}]`;

    if (anyTool?.function) {
      issues.push(`${toolName}: legacy function wrapper must be normalized before request`);
    }

    if (typeof anyTool?.name !== 'string' || !anyTool.name.trim()) {
      issues.push(`${toolName}: missing function name`);
    }

    const parameters = anyTool?.parameters;
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
      issues.push(`${toolName}: parameters must be an object schema`);
      continue;
    }

    if ((parameters as any).type !== 'object') {
      issues.push(`${toolName}: root parameters.type must be object`);
    }

    for (const hit of collectUnsupportedStrictSchemaKeys(parameters)) {
      issues.push(`${toolName}: unsupported strict-schema key at ${hit}`);
    }

    validateStrictObjectSchema(parameters, toolName, '$', issues);
  }

  return issues.length ? { ok: false, issues } : { ok: true };
}

export async function createModelResponse(params: {
  client: OpenAI;
  model: string;
  input: OpenAI.Responses.ResponseInputItem[];
  instructions: string;
  state: ResponsesStateMode;
  tools: OpenAI.Responses.Tool[];
  reasoning?: { effort: string; summary?: 'auto' | 'concise' | 'detailed' };
  text?: { verbosity?: 'low' | 'medium' | 'high' };
  maxOutputTokens?: number;
}): Promise<Response> {
  const payload: Record<string, unknown> = {
    model: params.model,
    input: params.input,
    instructions: params.instructions,
    tools: params.tools,
    parallel_tool_calls: false,
  };

  if (params.reasoning) payload.reasoning = params.reasoning;
  if (params.text) payload.text = params.text;
  if (typeof params.maxOutputTokens === 'number') {
    payload.max_output_tokens = params.maxOutputTokens;
  }

  if (params.state.kind === 'previous_response') {
    payload.previous_response_id = params.state.previousResponseId;
  }

  return params.client.responses.create(payload as any);
}

export function extractConversationId(
  response: Response,
  fallback: string | null,
): string | null {
  const anyResponse = response as any;
  return anyResponse?.conversation?.id ?? anyResponse?.conversation_id ?? fallback;
}

export function extractFunctionCalls(output: unknown): ExtractedFunctionCall[] {
  if (!Array.isArray(output)) return [];

  return output
    .filter((item: any) => item?.type === 'function_call')
    .map((item: any) => ({
      call_id: String(item.call_id ?? ''),
      name: String(item.name ?? ''),
      arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {}),
    }))
    .filter((item) => item.call_id && item.name);
}

function contentPartToText(part: any): string {
  if (!part) return '';
  if (typeof part?.text === 'string') return part.text;
  if (typeof part?.output_text === 'string') return part.output_text;
  if (typeof part === 'string') return part;
  return '';
}

export function extractFinalAssistantMessage(response: Response): FinalAssistantMessage | null {
  const anyResponse = response as any;

  if (typeof anyResponse?.output_text === 'string' && anyResponse.output_text.trim()) {
    return {
      text: anyResponse.output_text.trim(),
      phase: 'final_answer',
    };
  }

  if (!Array.isArray(anyResponse?.output)) return null;

  const messageItems = anyResponse.output.filter((item: any) => item?.type === 'message');
  if (messageItems.length === 0) return null;

  const lastMessage = messageItems[messageItems.length - 1];
  const text = Array.isArray(lastMessage?.content)
    ? lastMessage.content.map(contentPartToText).filter(Boolean).join('\n').trim()
    : '';

  if (!text) return null;

  const rawPhase = typeof lastMessage?.phase === 'string' ? lastMessage.phase : null;
  const phase: PublicResponsePhase =
    rawPhase === 'commentary' || rawPhase === 'final_answer' ? rawPhase : 'final_answer';

  return { text, phase };
}

export function responseUsage(response: Response): unknown {
  return (response as any)?.usage ?? null;
}

export function normalizePublicChatSuccess(params: {
  sessionId: string;
  response: Response;
  routing: ModelRoutingDecision;
  deliveredReasoningEffort?: string | null;
  state: {
    previousResponseId: string | null;
  };
}): PublicChatSuccess {
  const finalMessage = extractFinalAssistantMessage(params.response);
  const deliveredReasoningEffort = Object.prototype.hasOwnProperty.call(
    params,
    'deliveredReasoningEffort',
  )
    ? (params.deliveredReasoningEffort ?? null)
    : (params.routing.reasoning?.effort ?? null);

  return {
    ok: true,
    sessionId: params.sessionId,
    response: {
      id: params.response.id ?? null,
      model: (params.response as any)?.model ?? params.routing.model,
      phase: finalMessage?.phase ?? 'unknown',
      outputText: finalMessage?.text ?? '',
      reason: params.routing.reason,
      reasoningEffort: deliveredReasoningEffort,
      state: params.state,
    },
    error: null,
  };
}

export function normalizePublicChatError(params: {
  sessionId: string;
  code: string;
  message: string;
}): PublicChatError {
  return {
    ok: false,
    sessionId: params.sessionId,
    response: null,
    error: {
      code: params.code,
      message: params.message,
    },
  };
}
