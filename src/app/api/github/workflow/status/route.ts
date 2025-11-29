import { NextResponse } from 'next/server';
import { getWorkflowStatus } from '../../../../../backend/github';

export async function POST(req: Request) {
  const { run_id, repo } = await req.json();

  if (typeof run_id !== 'number') {
    return NextResponse.json({ error: 'Invalid run_id' }, { status: 400 });
  }

  try {
    const result = await getWorkflowStatus({ run_id, repo });
    return NextResponse.json({ result });
    } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error('Get workflow status failed');

    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}
