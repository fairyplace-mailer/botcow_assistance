import { randomUUID } from 'crypto';

import { NextResponse } from 'next/server';

import { runAssistant } from '../../../backend/assistant';
import type { ChatRequestBody } from '../../../backend/contracts/chat';
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

export async function POST(req: Request) {
  const startedAt = Date.now();
  const sessionId = normalizeSessionId(req);

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
    });

    if (result.error || !result.response) {
      return NextResponse.json(
        normalizePublicChatError({
          sessionId,
          code: result.error?.publicCode ?? 'assistant_run_failed',
          message: result.error?.publicMessage ?? 'Chat request failed.',
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
      error: {
        name: error?.name ?? null,
        message: error?.message ?? 'Unknown error',
      },
    });

    return NextResponse.json(
      normalizePublicChatError({
        sessionId,
        code: 'chat_request_failed',
        message: 'Chat request failed.',
      }),
      { status: 500 },
    );
  }
}
