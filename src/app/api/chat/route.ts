import { randomUUID } from 'crypto';

import { NextResponse } from 'next/server';

import { runAssistant } from '../../../backend/assistant';
import type { ChatMessage, ChatRequestBody, ChatRole } from '../../../backend/contracts/chat';
import { logEvent } from '../../../backend/log';
import { planAssistantTurn } from '../../../backend/orchestrator/planAssistantTurn';
import { normalizePublicChatError, normalizePublicChatSuccess } from '../../../backend/responses';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const ALLOWED_ROLES = new Set<ChatRole>(['user']);
const MAX_MESSAGE_CHARS = 20000;

function isChatRole(value: string): value is ChatRole {
  return ALLOWED_ROLES.has(value as ChatRole);
}

function normalizeMessageContent(content: unknown): string | null {
  if (typeof content === 'string') {
    const trimmed = content.trim();
    return trimmed ? trimmed : null;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        if (typeof part === 'object' && part !== null && 'text' in part) {
          return String(part.text ?? '');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();

    return text ? text : null;
  }

  if (isPlainObject(content) && 'text' in content) {
    const text = String(content.text ?? '').trim();
    return text ? text : null;
  }

  return null;
}

function normalizeMessages(input: unknown): ChatMessage[] | null {
  if (!Array.isArray(input)) return null;
  if (input.length !== 1) return null;

  const [item] = input;
  if (!isPlainObject(item)) return null;

  const role = typeof item.role === 'string' ? item.role.trim() : '';
  if (!isChatRole(role)) return null;

  const content = normalizeMessageContent(item.content);
  if (!content) return null;
  if (content.length > MAX_MESSAGE_CHARS) return null;

  return [{ role, content }];
}

function normalizeState(input: unknown): ChatRequestBody['state'] {
  if (!isPlainObject(input)) return undefined;

  const previousResponseId =
    typeof input.previousResponseId === 'string' && input.previousResponseId.trim()
      ? input.previousResponseId.trim()
      : undefined;

  if (!previousResponseId) return undefined;

  return { previousResponseId };
}

function normalizeRequestBody(body: unknown): ChatRequestBody | null {
  if (!isPlainObject(body)) return null;

  const messages = normalizeMessages(body.messages);
  if (!messages) return null;

  return {
    messages,
    hints: isPlainObject(body.hints) ? body.hints : {},
    ...(normalizeState(body.state) ? { state: normalizeState(body.state) } : {}),
  };
}

function normalizeSessionId(req: Request): string {
  const fromHeader = req.headers.get('x-botcow-session-id')?.trim();
  return fromHeader || randomUUID();
}

function shouldExposeInternalStopReason(req: Request, _body?: ChatRequestBody): boolean {
  if (req.headers.get('x-botcow-debug') === '1') return true;
  if (process.env.NODE_ENV !== 'production') return true;
  return false;
}

function readInternalStopReason(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;

  const record = error as Record<string, unknown>;
  const candidates = [
    record.internalCode,
    record.stopReason,
    record.code,
    record.publicCode,
  ];

  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  return null;
}

function readErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;

  const record = error as Record<string, any>;
  const candidates = [
    record.status,
    record.statusCode,
    record.cause?.status,
    record.cause?.statusCode,
  ];

  for (const value of candidates) {
    if (typeof value === 'number') return value;
  }

  return null;
}

function isRetryableUpstreamStatus(status: number | null): boolean {
  return status === 408 || status === 409 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
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

function readRetryAfterHeader(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;

  const record = error as Record<string, any>;
  const headerSources = [
    record.headers,
    record.response?.headers,
    record.cause?.headers,
    record.cause?.response?.headers,
  ];

  for (const headers of headerSources) {
    const retryAfter = readHeaderValue(headers, 'retry-after');
    if (retryAfter) return retryAfter;

    const retryAfterMs = readHeaderValue(headers, 'retry-after-ms');
    if (retryAfterMs) {
      const n = Number(retryAfterMs);
      if (Number.isFinite(n) && n >= 0) return String(Math.max(1, Math.ceil(n / 1000)));
    }
  }

  return null;
}

function formatVisibleErrorMessage(params: {
  debugMode: boolean;
  fallbackMessage: string;
  stopReason: string | null;
}): string {
  if (!params.debugMode) return params.fallbackMessage;
  if (!params.stopReason) return params.fallbackMessage;
  return `${params.fallbackMessage} [debug: ${params.stopReason}]`;
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  const sessionId = normalizeSessionId(req);
  let debugMode = process.env.NODE_ENV !== 'production';

  try {
    const rawBody = await req.json();
    const body = normalizeRequestBody(rawBody);

    if (!body) {
      return NextResponse.json(
        normalizePublicChatError({
          sessionId,
          code: 'invalid_messages',
          message: 'Invalid messages.',
        }),
        { status: 400 },
      );
    }

    debugMode = shouldExposeInternalStopReason(req, body);

    const messages = body.messages;
    const plan = planAssistantTurn({
      messages,
      hints: body.hints ?? {},
    });

    const result = await runAssistant({
      instructions: plan.instructions,
      messages,
      routing: plan.run,
      state: body.state ?? {},
    });

    await logEvent('chat_request_completed', {
      sessionId,
      model: plan.routing.model,
      modelReason: plan.routing.reason,
      reasoningEffort: result.reasoningDecision.sentReasoningEffort,
      durationMs: Date.now() - startedAt,
      ok: !result.error,
      responseId: result.response?.id ?? null,
      previousResponseId: result.state.previousResponseId,
      toolCalls: result.toolCalls.length,
      debugMode,
      stopReason: readInternalStopReason(result.error),
    });

    if (result.error || !result.response) {
      const publicCode = result.error?.publicCode ?? 'assistant_run_failed';
      const fallbackMessage = result.error?.publicMessage ?? 'Не удалось завершить действие автоматически.';
      const stopReason = readInternalStopReason(result.error);

      return NextResponse.json(
        normalizePublicChatError({
          sessionId,
          code: publicCode,
          message: formatVisibleErrorMessage({
            debugMode,
            fallbackMessage,
            stopReason,
          }),
        }),
        { status: 500 },
      );
    }

    return NextResponse.json(
      normalizePublicChatSuccess({
        sessionId,
        response: result.response,
        routing: plan.routing,
        deliveredReasoningEffort: result.reasoningDecision.sentReasoningEffort,
        state: {
          previousResponseId: result.state.previousResponseId,
        },
      }),
    );
  } catch (error: any) {
    const upstreamStatus = readErrorStatus(error);
    const retryAfter = readRetryAfterHeader(error);
    const responseStatus = isRetryableUpstreamStatus(upstreamStatus) ? 503 : 500;

    await logEvent('chat_request_failed', {
      sessionId,
      durationMs: Date.now() - startedAt,
      debugMode,
      stopReason: readInternalStopReason(error),
      upstreamStatus,
      retryAfter,
      error: {
        name: error?.name ?? null,
        message: error?.message ?? 'Unknown error',
      },
    });

    return NextResponse.json(
      normalizePublicChatError({
        sessionId,
        code: 'chat_request_failed',
        message: formatVisibleErrorMessage({
          debugMode,
          fallbackMessage: 'Не удалось завершить действие автоматически.',
          stopReason: readInternalStopReason(error) ?? (error?.name ? String(error.name) : null),
        }),
      }),
      {
        status: responseStatus,
        ...(retryAfter && responseStatus === 503 ? { headers: { 'Retry-After': retryAfter } } : {}),
      },
    );
  }
}
