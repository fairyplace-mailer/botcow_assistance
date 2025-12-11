import { runWorkflow, listWorkflowRuns, getWorkflowStatus } from './github';
import { saveRun, getLastRun } from './ciStore';

export type RunTrackResult = {
  runId: number | null;
  workflowId: string;
  ref: string;
  startedAt: string;
};

/**
 * Запустить workflow и попытаться отследить созданный run_id.
 * Сохраняет запись в локальное хранилище ciStore.
 */
export async function runWorkflowAndTrack(options: {
  workflow_id?: string;
  ref?: string;
  repo?: string;
  inputs?: Record<string, string>;
}) {
  const workflow_id = options.workflow_id ?? 'ci.yml';
  const ref = options.ref ?? 'main';
  const repo = options.repo;

  const dispatchTime = new Date().toISOString();

  // trigger workflow dispatch (doesn't return run id)
  const result = await runWorkflow({ workflow_id, ref, repo: repo, inputs: options.inputs });

  // Try to find the created workflow run by polling listWorkflowRuns
  let foundRunId: number | null = null;

  try {
    const repoName = repo ?? process.env.BOTCOW_DEFAULT_REPO!;
    const maxAttempts = 8;
    let attempt = 0;
    const perPage = 10;

    while (attempt < maxAttempts) {
      const res = await listWorkflowRuns({
        workflow_id,
        branch: ref,
        repo: repoName,
        event: 'workflow_dispatch',
        per_page: perPage,
      });

      const runs = res.runs || [];

      // Prefer the most recent run
      const match = runs[0];

      if (match) {
        foundRunId = match.id as number;
        break;
      }

      attempt++;
      await new Promise((r) => setTimeout(r, 1000 * Math.min(5, attempt)));
    }
  } catch (e) {
    // ignore - best-effort
  }

  const repoName = options.repo ?? process.env.BOTCOW_DEFAULT_REPO!;

  await saveRun(repoName, {
    run_id: foundRunId,
    workflow_id,
    ref,
    startedAt: dispatchTime,
    status: foundRunId ? 'found' : 'pending',
  });

  const out: RunTrackResult = {
    runId: foundRunId,
    workflowId: workflow_id,
    ref,
    startedAt: dispatchTime,
  };

  return { result, tracked: out };
}

/**
 * Получить статус запуска workflow, с обработкой ошибок прав доступа/не найдено.
 */
export async function getWorkflowRunStatus(args: { run_id: number; repo?: string }) {
  try {
    const data = await getWorkflowStatus(args);
    return { data };
  } catch (err: any) {
    // Octokit errors usually have status
    const status = err?.status;
    if (status === 401 || status === 403) {
      throw new Error('GitHub API access denied: token lacks workflow/read permissions (401/403)');
    }
    if (status === 404) {
      throw new Error('Workflow run not found (404). Possibly insufficient rights or wrong run_id');
    }
    throw err;
  }
}
