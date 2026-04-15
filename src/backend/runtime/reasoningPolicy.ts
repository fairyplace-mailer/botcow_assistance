import type OpenAI from 'openai';

import type { ModelRoutingDecision, ReasoningEffort } from '../modelRouter';
import {
  REASONING_ALLOWED_EFFORTS,
  supportsReasoning,
  type ReasoningSuppressedReason,
  type ResponsesRuntimeCapabilities,
} from '../openaiRuntime';
import type { ResponsesStateMode } from '../responses';

export type ReasoningDecision = {
  requestedReasoningEffort: ReasoningEffort | null;
  sentReasoningEffort: ReasoningEffort | null;
  reasoningSuppressedReason: ReasoningSuppressedReason | null;
};

function pendingInputNeedsReasoningStateCarry(
  input: OpenAI.Responses.ResponseInputItem[] | undefined,
): boolean {
  if (!Array.isArray(input) || input.length === 0) return false;

  return input.some((item: any) => item?.type === 'function_call_output' || item?.type === 'reasoning');
}

function statePathSupportsReasoning(params: {
  stateMode: ResponsesStateMode;
  pendingInput?: OpenAI.Responses.ResponseInputItem[];
}): boolean {
  if (params.stateMode.kind === 'conversation') return true;
  if (params.stateMode.kind === 'previous_response') return true;

  return !pendingInputNeedsReasoningStateCarry(params.pendingInput);
}

export function resolveReasoningDecision(
  routing: Pick<ModelRoutingDecision, 'model' | 'reasoning'>,
  runtimeCapabilities: ResponsesRuntimeCapabilities,
  options?: {
    stateMode?: ResponsesStateMode;
    pendingInput?: OpenAI.Responses.ResponseInputItem[];
  },
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

  if (
    options?.stateMode &&
    !statePathSupportsReasoning({
      stateMode: options.stateMode,
      pendingInput: options.pendingInput,
    })
  ) {
    return {
      requestedReasoningEffort,
      sentReasoningEffort: null,
      reasoningSuppressedReason: 'state_path_not_supported',
    };
  }

  return {
    requestedReasoningEffort,
    sentReasoningEffort: requestedReasoningEffort,
    reasoningSuppressedReason: null,
  };
}
