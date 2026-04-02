import type { ModelId, ReasoningEffort } from './modelRouter';

export type ReasoningSuppressedReason =
  | 'model_not_supported'
  | 'runtime_not_supported'
  | 'sdk_contract_unknown';

export type ResponsesRuntimeCapabilities = {
  path: 'openai.responses.create';
  reasoning: 'supported' | 'unsupported' | 'unknown';
  sdkVersion: string | null;
};

export const OPENAI_SDK_VERSION = '6.16.0';

export const DEFAULT_RESPONSES_RUNTIME_CAPABILITIES: ResponsesRuntimeCapabilities = {
  path: 'openai.responses.create',
  reasoning: 'supported',
  sdkVersion: OPENAI_SDK_VERSION,
};

export const REASONING_ALLOWED_EFFORTS: Readonly<Record<ModelId, ReadonlySet<Exclude<ReasoningEffort, 'none'>>>> = {
  'gpt-5.4': new Set(['low', 'medium', 'high', 'xhigh']),
  'gpt-5.4-mini': new Set(),
  'gpt-5.4-nano': new Set(),
};

export function getResponsesRuntimeCapabilities(): ResponsesRuntimeCapabilities {
  return DEFAULT_RESPONSES_RUNTIME_CAPABILITIES;
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
