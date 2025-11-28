import { NextResponse } from 'next/server';
import { openai } from '../../../backend/openai';
import { logEvent } from '../../../backend/log';

export async function POST(req: Request) {
  const startedAt = Date.now();
  const { messages } = await req.json();

  if (!messages || !Array.isArray(messages)) {
    return NextResponse.json({ error: 'Invalid messages' }, { status: 400 });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
    });

    const ms = Date.now() - startedAt;

    await logEvent('chat', {
      messages,
      completion,
      durationMs: ms,
    });

    return NextResponse.json(completion);
  } catch (error: any) {
    const ms = Date.now() - startedAt;

    await logEvent('chat-error', {
      messages,
      error: {
        message: error?.message,
        name: error?.name,
      },
      durationMs: ms,
    });

    return NextResponse.json(
      { error: 'Chat request failed' },
      { status: 500 },
    );
  }
}
