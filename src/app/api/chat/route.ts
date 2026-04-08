import { randomUUID } from 'crypto';

import { NextResponse } from 'next/server';

import { runAssistant } from '../../../backend/assistant';
import type { ChatRequestBody } from '../../../backend/contracts/chat';
import { buildCoreInstructions } from '../../../backend/prompt/buildCoreInstructions';
import { chooseModel } from '../../../backend/modelRouter';
import { normalizePublicChatError, normalizePublicChatSuccess } from '../../../backend/responses';
import { logEvent } from '../../../backend/log';

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
    const routing = chooseModel(messages, rawBody.hints ?? {});
    const instructions = buildCoreInstructions({
      routing,
      hints: rawBody.hints,
    });

    const result = await runAssistant({
      instructions,
      messages,
      routing: {
        model: routing.model,
        reasoning: routing.reasoning,
        reason: routing.reason,
        text: { verbosity: routing.model === 'gpt-5.4' ? 'medium' : 'low' },
        maxOutputTokens: routing.model === 'gpt-5.4' ? 8000 : 4000,
      },
      state: rawBody.state ?? {},
    });

    await logEvent('chat_request_completed', {
      sessionId,
      model: routing.model,
      modelReason: routing.reason,
      reasoningEffort: routing.reasoning?.effort ?? null,
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
        routing,
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
