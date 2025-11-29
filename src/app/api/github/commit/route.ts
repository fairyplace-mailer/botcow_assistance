import { NextResponse } from 'next/server';
import { commitFile } from '../../../../backend/github';

export async function POST(req: Request) {
  const { path, content, message, branch, repo } = await req.json();

  if (!path || typeof path !== 'string') {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }
  if (!branch || typeof branch !== 'string') {
    return NextResponse.json({ error: 'Invalid branch' }, { status: 400 });
  }
  if (!message || typeof message !== 'string') {
    return NextResponse.json({ error: 'Invalid message' }, { status: 400 });
  }

  try {
    const result = await commitFile({
      path,
      content: content ?? '',
      message,
      branch,
      repo,
    });

    return NextResponse.json({ result });
    } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error('Commit failed');

    return NextResponse.json(
      { error: err.message },
      { status: 500 },
    );
  }
}
