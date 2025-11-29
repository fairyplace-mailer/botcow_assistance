import { NextResponse } from 'next/server';
import { createPullRequest } from '../../../../backend/github';

export async function POST(req: Request) {
  const { title, head, base, body, repo } = await req.json();

  if (!title || typeof title !== 'string') {
    return NextResponse.json({ error: 'Invalid title' }, { status: 400 });
  }
  if (!head || typeof head !== 'string') {
    return NextResponse.json({ error: 'Invalid head' }, { status: 400 });
  }

  try {
    const pr = await createPullRequest({
      title,
      head,
      base,
      body,
      repo,
    });

    return NextResponse.json({ pr });
    } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error('Create PR failed');

    return NextResponse.json(
      { error: err.message },
      { status: 500 },
    );
  }
}
