import { NextResponse } from 'next/server';
import { runWorkflow } from '../../../../../backend/github';
import { saveRun } from '../../../../../backend/ciStore';

export async function POST(req: Request) {
  const { workflow_id, ref, repo, inputs } = await req.json();

  try {
    const result = await runWorkflow({ workflow_id, ref, repo, inputs });

    const repoName = repo ?? process.env.BOTCOW_DEFAULT_REPO!;
    const wfId = workflow_id ?? 'ci.yml';
    const branchRef = ref ?? 'main';

    // Try to find the created workflow run (createWorkflowDispatch doesn't return run_id).
    let foundRunId: number | null = null;
    try {
      const backend = await import('../../../../../backend/github');
      const { github, parseRepo } = backend;
      const parsed = parseRepo(repoName);

      // Poll a few times for the run to appear in GitHub API
      for (let attempt = 0; attempt < 5; attempt++) {
        const runsRes = await github.actions.listWorkflowRunsForRepo({
          owner: parsed.owner,
          repo: parsed.repo,
          workflow_id: wfId,
          branch: branchRef,
          event: 'workflow_dispatch',
          per_page: 5,
        });

        const runs = runsRes.data.workflow_runs || [];
        const match = runs.find((r: any) => r.head_branch === branchRef || r.head_sha === branchRef);
        if (match) {
          foundRunId = match.id as number;
          break;
        }

        // small delay
        await new Promise((res) => setTimeout(res, 1000));
      }
    } catch (e) {
      // ignore and persist placeholder if we can't call GitHub
    }

    await saveRun(repoName, {
      run_id: foundRunId ?? -1,
      workflow_id: wfId,
      ref: branchRef,
      startedAt: new Date().toISOString(),
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
