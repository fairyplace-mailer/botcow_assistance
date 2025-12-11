import { NextResponse } from 'next/server';
import { runWorkflowAndTrack } from '../../../../../backend/ciRunner';

export async function POST(req: Request) {
  const { workflow_id, ref, repo, inputs } = await req.json();

  try {
    const res = await runWorkflowAndTrack({ workflow_id, ref, repo, inputs });

    // return both dispatched result and tracked info
    return NextResponse.json({ dispatched: true, tracked: res.tracked, result: res.result });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Run workflow failed' },
      { status: 500 },
    );
  }
}
