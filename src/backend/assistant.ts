import type OpenAI from 'openai';
import type { Response } from 'openai/resources/responses/responses';

import type { ModelRoutingDecision, ReasoningEffort } from './modelRouter';
import {
  getResponsesRuntimeCapabilities,
  supportsReasoning,
  type ReasoningSuppressedReason,
  type ResponsesRuntimeCapabilities,
} from './openaiRuntime';
import { resolveReasoningDecision, type ReasoningDecision } from './runtime/reasoningPolicy';
import { runAssistantRuntime } from './runtime/runAssistantRuntime';

export type AssistantInternalCode =
  | 'invalid_tool_args_json'
  | 'invalid_tool_args_schema'
  | 'unknown_tool'
  | 'tool_not_allowed'
  | 'tool_timeout'
  | 'tool_execution_failed'
  | 'repeated_tool_call'
  | 'no_progress_abort'
  | 'response_incomplete'
  | 'tool_budget_exceeded'
  | 'no_actionable_output'
  | 'tool_loop_limit'
  | 'invalid_tool_schema'
  | 'provider_invalid_request'
  | 'provider_runtime_failed';

export type AssistantRunOptions = {
  model: ModelRoutingDecision['model'];
  reasoning?: { effort: ReasoningEffort };
  text?: { verbosity?: 'low' | 'medium' | 'high' };
  maxOutputTokens?: number;
  reason?: string;
};

export type ConversationStateRef = {
  previousResponseId?: string;
};

export type RunAssistantTurnParams = {
  instructions: string;
  messages: Array<{ role: string; content: unknown }>;
  tools?: OpenAI.Responses.Tool[];
  routing: AssistantRunOptions;
  state: ConversationStateRef;
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
    previousResponseId: string | null;
  };
  error?: {
    publicCode: 'assistant_run_failed';
    publicMessage: string;
    internalCode: AssistantInternalCode;
    responseId?: string;
  };
};

export { getResponsesRuntimeCapabilities, supportsReasoning, resolveReasoningDecision };
export type { ResponsesRuntimeCapabilities, ReasoningSuppressedReason, ReasoningDecision };

export async function runAssistant(params: RunAssistantTurnParams): Promise<AssistantResult> {
  return runAssistantRuntime(params);
}
