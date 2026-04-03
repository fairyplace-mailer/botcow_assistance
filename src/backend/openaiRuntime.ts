import type { ModelId, ReasoningEffort } from './modelRouter';

export type ReasoningSuppressedReason =
  | 'model_not_supported'
  | 'runtime_not_supported'
  | 'sdk_contract_unknown';

export type ResponsesRuntimeCapabilities = {
  path: 'openai.responses.create';
  reasoning: 'supported' | 'unsupported' | 'unknown';
  sdkVersion: string | null;
  apiBaseUrl: string | null;
  runtimeKind: 'openai' | 'custom';
};

function readPackageVersion(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('openai/package.json') as { version?: unknown };
    return typeof pkg?.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

function normalizeBaseUrl(rawBaseUrl: string | undefined): string | null {
  const trimmed = rawBaseUrl?.trim();
  if (!trimmed) {
    return 'https://api.openai.com/v1';
  }

  return trimmed.replace(/\/+$/, '');
}

function inferRuntimeKind(apiBaseUrl: string | null): 'openai' | 'custom' {
  if (!apiBaseUrl) {
    return 'custom';
  }

  try {
    const parsed = new URL(apiBaseUrl);
    return parsed.hostname === 'api.openai.com' ? 'openai' : 'custom';
  } catch {
    return 'custom';
  }
}

export const OPENAI_SDK_VERSION = readPackageVersion();

export const REASONING_ALLOWED_EFFORTS: Readonly<Record<ModelId, ReadonlySet<ReasoningEffort>>> = {
  'gpt-5.4': new Set(['none', 'low', 'medium', 'high', 'xhigh']),
  'gpt-5.4-mini': new Set(['none', 'low', 'medium', 'high']),
  'gpt-5.4-nano': new Set(['none', 'low']),
};

export function getResponsesRuntimeCapabilities(): ResponsesRuntimeCapabilities {
  const apiBaseUrl = normalizeBaseUrl(process.env.OPENAI_BASE_URL);
  const runtimeKind = inferRuntimeKind(apiBaseUrl);

  return {
    path: 'openai.responses.create',
    reasoning: runtimeKind === 'openai' ? 'supported' : 'unknown',
    sdkVersion: OPENAI_SDK_VERSION,
    apiBaseUrl,
    runtimeKind,
  };
}

export function supportsReasoning(
  model: ModelId,
  runtimeCapabilities: ResponsesRuntimeCapabilities,
): boolean {
  if (runtimeCapabilities.path !== 'openai.responses.create') {
    return false;
  }

  if (runtimeCapabilities.runtimeKind !== 'openai') {
    return false;
  }

  if (runtimeCapabilities.reasoning !== 'supported') {
    return false;
  }

  return (REASONING_ALLOWED_EFFORTS[model]?.size ?? 0) > 0;
}
