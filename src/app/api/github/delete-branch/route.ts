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
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Delete branch failed' },
      { status: 500 },
    );
  }
}
