import { NextResponse } from 'next/server';
import { createBranch } from '../../../../backend/github';

export async function POST(req: Request) {
  const { branchName, baseBranch, repo } = await req.json();

  if (!branchName || typeof branchName !== 'string') {
    return NextResponse.json({ error: 'Invalid branchName' }, { status: 400 });
  }

  try {
    const result = await createBranch(branchName, baseBranch, repo);
    return NextResponse.json({ result });
    } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error('Create branch failed');

    return NextResponse.json(
      { error: err.message },
      { status: 500 },
    );
  }
}
