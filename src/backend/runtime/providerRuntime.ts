import { createModelResponse } from '../responses';

const OPENAI_RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);
const OPENAI_MAX_ATTEMPTS = 3;

function isRetryableOpenAIError(error: any): boolean {
  const status = error?.status ?? error?.statusCode ?? error?.cause?.status;
  if (typeof status === 'number' && OPENAI_RETRYABLE_STATUS.has(status)) return true;

  const code = String(error?.code ?? error?.cause?.code ?? '').toLowerCase();
  return code === 'etimedout' || code === 'econnreset' || code === 'eai_again';
}

function readHeaderValue(headers: unknown, name: string): string | null {
  if (!headers) return null;
  const target = name.toLowerCase();

  if (typeof (headers as any)?.get === 'function') {
    const value = (headers as any).get(name) ?? (headers as any).get(target);
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  if (Array.isArray(headers)) {
    for (const entry of headers) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const key = String(entry[0] ?? '').toLowerCase();
      if (key !== target) continue;
      const value = String(entry[1] ?? '').trim();
      if (value) return value;
    }
  }

  if (typeof headers === 'object' && headers !== null) {
    for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
      if (key.toLowerCase() !== target) continue;
      const normalized = String(value ?? '').trim();
      if (normalized) return normalized;
    }
  }

  return null;
}

function readRetryAfterMs(error: any): number | null {
  const headerSources = [
    error?.headers,
    error?.response?.headers,
    error?.cause?.headers,
    error?.cause?.response?.headers,
  ];

  for (const headers of headerSources) {
    const retryAfterMs = readHeaderValue(headers, 'retry-after-ms');
    if (retryAfterMs) {
      const n = Number(retryAfterMs);
      if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
    }

    const retryAfter = readHeaderValue(headers, 'retry-after');
    if (retryAfter) {
      const n = Number(retryAfter);
      if (Number.isFinite(n) && n >= 0) return Math.ceil(n * 1000);
    }
  }

  return null;
}

function computeRetryDelayMs(error: any, attempt: number): number {
  const hinted = readRetryAfterMs(error);
  if (hinted !== null) return hinted;

  const base = 400 * Math.pow(2, attempt - 1);
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(base + jitter, 8000);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createModelResponseWithRetry(
  params: Parameters<typeof createModelResponse>[0],
  options?: {
    onRetry?: (meta: {
      attempt: number;
      nextAttempt: number;
      delayMs: number;
      status: number | null;
      code: string | null;
    }) => Promise<void> | void;
  },
) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= OPENAI_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await createModelResponse(params);
    } catch (error: any) {
      lastError = error;
      if (attempt >= OPENAI_MAX_ATTEMPTS || !isRetryableOpenAIError(error)) {
        throw error;
      }

      const delayMs = computeRetryDelayMs(error, attempt);
      const status =
        typeof error?.status === 'number'
          ? error.status
          : typeof error?.statusCode === 'number'
            ? error.statusCode
            : typeof error?.cause?.status === 'number'
              ? error.cause.status
              : null;
      const codeRaw = error?.code ?? error?.cause?.code ?? null;
      const code = typeof codeRaw === 'string' && codeRaw.trim() ? codeRaw.trim() : null;

      await options?.onRetry?.({
        attempt,
        nextAttempt: attempt + 1,
        delayMs,
        status,
        code,
      });

      await delay(delayMs);
    }
  }

  throw lastError;
}

function readProviderErrorDetails(error: any) {
  return {
    status: error?.status ?? error?.statusCode ?? error?.cause?.status ?? null,
    code: String(error?.code ?? error?.cause?.code ?? '').trim().toLowerCase() || null,
    type: String(error?.type ?? error?.error?.type ?? '').trim().toLowerCase() || null,
    message: error?.message ? String(error.message) : null,
  };
}

export function classifyProviderError(error: any): 'provider_invalid_request' | 'provider_runtime_failed' {
  const details = readProviderErrorDetails(error);

  if (details.status === 400 || details.code === 'invalid_value' || details.type === 'invalid_request_error') {
    return 'provider_invalid_request';
  }

  return 'provider_runtime_failed';
}
