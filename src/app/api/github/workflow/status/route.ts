import { NextResponse } from 'next/server';
import { getWorkflowStatus } from '../../../../../backend/github';
import { getLastRun, saveRun } from '../../../../../backend/ciStore';

export async function POST(req: Request) {
  let { run_id, repo } = await req.json();

  repo = repo ?? process.env.BOTCOW_DEFAULT_REPO;

  if (!repo) {
    return NextResponse.json({ error: 'repo not specified' }, { status: 400 });
  }

  if (!run_id) {
    const last = await getLastRun(repo);
    if (!last) {
      return NextResponse.json({ error: 'no run tracked for repo' }, { status: 404 });
    }
    // if placeholder (-1) then we need to try to resolve latest run
    if (last.run_id === -1) {
      try {
        const backend = await import('../../../../../backend/github');
        const { github, parseRepo } = backend;
        const parsed = parseRepo(repo);

        const runsRes = await github.actions.listWorkflowRunsForRepo({
          owner: parsed.owner,
          repo: parsed.repo,
          workflow_id: last.workflow_id,
          branch: last.ref,
          event: 'workflow_dispatch',
          per_page: 1,
        });

        const runs = runsRes.data.workflow_runs || [];
        if (runs.length > 0) {
          const match = runs[0];
          await saveRun(repo, {
            run_id: match.id,
            workflow_id: last.workflow_id,
            ref: last.ref,
            startedAt: last.startedAt,
          });
          run_id = match.id;
        }
      } catch (e) {
        // ignore - fallthrough
      }
    } else {
      run_id = last.run_id;
    }
  }

  if (typeof run_id !== 'number') {
    return NextResponse.json({ error: 'Invalid run_id' }, { status: 400 });
  }

  try {
    const result = await getWorkflowStatus({ run_id, repo });
    return NextResponse.json({ result });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Get workflow status failed' },
      { status: 500 }
    );
  }
}
