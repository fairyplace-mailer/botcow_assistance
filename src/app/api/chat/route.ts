import { randomUUID } from 'crypto';

import { NextResponse } from 'next/server';

import { runAssistant } from '../../../backend/assistant';
import type { ChatMessage, ChatRequestBody } from '../../../backend/contracts/chat';
import { logEvent } from '../../../backend/log';
import { planAssistantTurn } from '../../../backend/orchestrator/planAssistantTurn';
import { normalizePublicChatError, normalizePublicChatSuccess } from '../../../backend/responses';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeSessionId(req: Request): string {
  const fromHeader = req.headers.get('x-botcow-session-id')?.trim();
  return fromHeader || randomUUID();
}

function validateBody(body: unknown): body is ChatRequestBody {
  if (!isPlainObject(body)) return false;
  if (!Array.isArray(body.messages)) return false;
  return true;
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

    if (!validateBody(rawBody)) {
      return NextResponse.json(
        normalizePublicChatError({
          sessionId,
          code: 'invalid_messages',
          message: 'Invalid messages.',
        }),
        { status: 400 },
      );
    }

    debugMode = shouldExposeInternalStopReason(req, rawBody);

    const messages = rawBody.messages;
    const plan = planAssistantTurn({
      messages,
      hints: rawBody.hints ?? {},
    });

    const result = await runAssistant({
      instructions: plan.instructions,
      messages,
      routing: plan.run,
      state: rawBody.state ?? {},
    });

    await logEvent('chat_request_completed', {
      sessionId,
      model: plan.routing.model,
      modelReason: plan.routing.reason,
      reasoningEffort: plan.routing.reasoning?.effort ?? null,
      durationMs: Date.now() - startedAt,
      ok: !result.error,
      responseId: result.response?.id ?? null,
      conversationId: result.state.conversationId,
      latestResponseId: result.state.latestResponseId,
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
        state: {
          conversationId: result.state.conversationId,
          previousResponseId: result.state.latestResponseId,
        },
      }),
    );
  } catch (error: any) {
    await logEvent('chat_request_failed', {
      sessionId,
      durationMs: Date.now() - startedAt,
      debugMode,
      stopReason: readInternalStopReason(error),
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
      { status: 500 },
    );
  }
}
