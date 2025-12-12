import { NextResponse } from 'next/server';
import { listWorkflowRuns } from '../../../../../backend/github';
import { getLastRun, saveRun } from '../../../../../backend/ciStore';
import { getWorkflowRunStatus } from '../../../../../backend/ciRunner';

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

    // if placeholder (null) then we need to try to resolve latest run
    if (last.run_id === null) {
      try {
        const res = await listWorkflowRuns({
          workflow_id: last.workflow_id,
          branch: last.ref,
          repo,
          event: 'workflow_dispatch',
          per_page: 10,
        });

        const runs = res.runs || [];
        const match = runs.find((r: any) => !!r.id);
        if (match) {
          await saveRun(repo, {
            run_id: match.id,
            workflow_id: last.workflow_id,
            ref: last.ref,
            startedAt: last.startedAt,
            status: 'found',
          });
          run_id = match.id;
        } else {
          // still not found
          await saveRun(repo, {
            ...last,
            status: 'not_found',
            run_id: null,
          });
        }
      } catch (e) {
        // ignore - fallthrough
      }
    } else {
      run_id = last.run_id as number;
    }
  }

  if (typeof run_id !== 'number') {
    return NextResponse.json({ error: 'Invalid run_id' }, { status: 400 });
  }

  try {
    const result = await getWorkflowRunStatus({ run_id, repo });
    return NextResponse.json({ result });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Get workflow status failed' },
      { status: 500 }
    );
  }
}
