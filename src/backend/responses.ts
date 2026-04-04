import type OpenAI from 'openai';
import type { Response } from 'openai/resources/responses/responses';

import type { PublicChatError, PublicChatSuccess, PublicResponsePhase } from './contracts/chat';
import type { ModelRoutingDecision } from './modelRouter';

export type ResponsesStateMode =
  | { kind: 'stateless' }
  | { kind: 'conversation'; conversation: { id: string } }
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

export function buildStrictFunctionTools(
  tools: OpenAI.Responses.Tool[],
): OpenAI.Responses.Tool[] {
  return tools.map((tool: any) => {
    if (tool?.type !== 'function') return tool;

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

  if (params.state.kind === 'conversation') {
    payload.conversation = params.state.conversation;
  } else if (params.state.kind === 'previous_response') {
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
  state: {
    conversationId: string | null;
    previousResponseId: string | null;
  };
}): PublicChatSuccess {
  const finalMessage = extractFinalAssistantMessage(params.response);

  return {
    ok: true,
    sessionId: params.sessionId,
    response: {
      id: params.response.id ?? null,
      model: (params.response as any)?.model ?? params.routing.model,
      phase: finalMessage?.phase ?? 'unknown',
      outputText: finalMessage?.text ?? '',
      reason: params.routing.reason,
      reasoningEffort: params.routing.reasoning?.effort ?? null,
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
