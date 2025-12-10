import { NextResponse } from 'next/server';
import { runWorkflow } from '../../../../../backend/github';
import { saveRun } from '../../../../../backend/ciStore';

export async function POST(req: Request) {
  const { workflow_id, ref, repo, inputs } = await req.json();

  try {
    const result = await runWorkflow({ workflow_id, ref, repo, inputs });

    // runWorkflow currently returns { dispatched: true, workflow_id, ref }
    // GitHub REST API for createWorkflowDispatch does not return run_id; we cannot get run_id synchronously here.
    // We'll store a placeholder record and advise the caller to call the status endpoint after a short delay.

    await saveRun(repo ?? process.env.BOTCOW_DEFAULT_REPO!, {
      run_id: -1,
      workflow_id: workflow_id ?? 'ci.yml',
      ref: ref ?? 'main',
      startedAt: new Date().toISOString(),
    });

    return NextResponse.json({ result, note: 'dispatched' });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Run workflow failed' },
      { status: 500 },
    );
  }
}
