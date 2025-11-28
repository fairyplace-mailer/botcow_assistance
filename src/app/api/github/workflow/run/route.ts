import { NextResponse } from 'next/server';
import { runWorkflow } from '../../../../../backend/github';

export async function POST(req: Request) {
  const { workflow_id, ref, repo, inputs } = await req.json();

  try {
    const result = await runWorkflow({ workflow_id, ref, repo, inputs });
    return NextResponse.json({ result });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Run workflow failed' },
      { status: 500 },
    );
  }
}
