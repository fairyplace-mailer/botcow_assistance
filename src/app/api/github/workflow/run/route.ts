import { NextResponse } from 'next/server';
import { runWorkflow } from '../../../../../backend/github';

export async function POST(req: Request) {
  const { workflow_id, ref, repo, inputs } = await req.json();

  try {
    const result = await runWorkflow({ workflow_id, ref, repo, inputs });
    return NextResponse.json({ result });
    } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error('Run workflow failed');

    return NextResponse.json(
      { error: err.message },
      { status: 500 },
    );
  }
}
