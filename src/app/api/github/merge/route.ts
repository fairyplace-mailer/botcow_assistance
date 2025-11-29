import { NextResponse } from 'next/server';
import { mergePullRequest } from '../../../../backend/github';

export async function POST(req: Request) {
  const { pull_number, repo } = await req.json();

  if (typeof pull_number !== 'number') {
    return NextResponse.json({ error: 'Invalid pull_number' }, { status: 400 });
  }

  try {
    const result = await mergePullRequest({ pull_number, repo });
    return NextResponse.json({ result });
    } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error('Merge PR failed');

    return NextResponse.json(
      { error: err.message },
      { status: 500 },
    );
  }
}
