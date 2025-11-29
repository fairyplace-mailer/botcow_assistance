import { NextResponse } from 'next/server';
import { deleteBranch } from '../../../../backend/github-branch';

export async function POST(req: Request) {
  const { branch, repo } = await req.json();

  if (!branch || typeof branch !== 'string') {
    return NextResponse.json({ error: 'Invalid branch' }, { status: 400 });
  }

  try {
    const result = await deleteBranch({ branch, repo });
    return NextResponse.json({ result });
    } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error('Delete branch failed');

    return NextResponse.json(
      { error: err.message },
      { status: 500 },
    );
  }
}
