import { NextResponse } from 'next/server';
import { runWorkflow, listWorkflowRuns } from '../../../../../backend/github';
import { saveRun } from '../../../../../backend/ciStore';

export async function POST(req: Request) {
  const { workflow_id, ref, repo, inputs } = await req.json();

  try {
    const result = await runWorkflow({ workflow_id, ref, repo, inputs });

    const repoName = repo ?? process.env.BOTCOW_DEFAULT_REPO!;
    const wfId = workflow_id ?? 'ci.yml';
    const branchRef = ref ?? 'main';
    const dispatchTime = new Date().toISOString();

    // Try to find the created workflow run (createWorkflowDispatch doesn't return run_id).
    let foundRunId: number | null = null;

    try {
      const parsed = (await import('../../../../../backend/github')).parseRepo(repoName);

      // Poll a few times for the run to appear in GitHub API
      const maxAttempts = 8;
      let attempt = 0;
      const perPage = 10;

      while (attempt < maxAttempts) {
        const res = await listWorkflowRuns({
          workflow_id: wfId,
          branch: branchRef,
          repo: repoName,
          event: 'workflow_dispatch',
          per_page: perPage,
        });

        const runs = res.runs || [];

        // Try exact head_sha match first (if inputs.ref provided as commit SHA)
        let match = runs.find((r) => r.head_sha === inputs?.ref);

        // Otherwise prefer same branch and created_at >= dispatchTime-30s
        if (!match) {
          const dispatchTs = new Date(dispatchTime).getTime();
          match = runs.find((r) => {
            if (!r.head_branch) return false;
            if (r.head_branch !== branchRef) return false;
            if (!r.created_at) return true; // be permissive if no timestamp
            const createdTs = new Date(r.created_at).getTime();
            return createdTs >= dispatchTs - 30000; // allow 30s tolerance
          });
        }

        if (match) {
          foundRunId = match.id as number;
          break;
        }

        attempt++;
        // backoff delay
        await new Promise((res) => setTimeout(res, 1000 * Math.min(5, attempt)));
      }
    } catch (e) {
      // ignore and persist placeholder if we can't call GitHub
    }

    await saveRun(repoName, {
      run_id: foundRunId,
      workflow_id: wfId,
      ref: branchRef,
      startedAt: dispatchTime,
      status: foundRunId ? 'found' : 'pending',
    });

    const out: any = { result, note: 'dispatched' };
    if (foundRunId) out.run_id = foundRunId;

    return NextResponse.json(out);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Run workflow failed' },
      { status: 500 },
    );
  }
}
