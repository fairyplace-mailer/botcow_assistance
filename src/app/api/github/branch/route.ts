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
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Create branch failed' },
      { status: 500 },
    );
  }
}
