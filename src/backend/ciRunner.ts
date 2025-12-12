import { runWorkflow, listWorkflowRuns, getWorkflowStatus, getRecentCommits, commitFile, getFile } from './github';
import { saveRun, getLastRun } from './ciStore';

export type RunTrackResult = {
  runId: number | null;
  workflowId: string;
  ref: string;
  startedAt: string;
  stored?: 'repo' | 'local';
  commitSha?: string | null;
};

const STORE_PATH = '.botcow/ci-runs.json';
const STORE_COMMIT_BRANCH = 'botcow-prevectus'; // per user request — persist tracking in this branch

/**
 * Запустить workflow и попытаться отследить созданный run_id.
 * Сначала пытаемся сопоставить по head_sha (коммиту) — это даёт надёжность.
 * Сохраняем запись в репозитории (файл .botcow/ci-runs.json в ветке botcow-prevectus). Если commit неудачен — fallback в локальное хранилище.
 */
export async function runWorkflowAndTrack(options: {
  workflow_id?: string;
  ref?: string;
  repo?: string;
  inputs?: Record<string, string>;
}) {
  const workflow_id = options.workflow_id ?? 'ci.yml';
  const ref = options.ref ?? 'main';
  const repo = options.repo ?? process.env.BOTCOW_DEFAULT_REPO!;

  const dispatchTime = new Date();
  const dispatchIso = dispatchTime.toISOString();

  // Try to get latest commit sha for the target ref — helps to match the created run
  let commitSha: string | null = null;
  try {
    const commits = await getRecentCommits({ branch: ref, limit: 1, repo });
    if (commits && commits.length > 0) {
      commitSha = commits[0].sha;
    }
  } catch (e) {
    // best-effort — continue without commitSha
    // console.warn('ciRunner: getRecentCommits failed', e);
  }

  // trigger workflow dispatch (doesn't return run id)
  const dispatchResult = await runWorkflow({ workflow_id, ref, repo, inputs: options.inputs });

  // Try to find the created workflow run by polling listWorkflowRuns
  let foundRunId: number | null = null;

  try {
    const repoName = repo;
    const maxAttempts = 20;
    let attempt = 0;
    const perPage = 10;

    const dispatchTimeMs = dispatchTime.getTime();

    while (attempt < maxAttempts) {
      const res = await listWorkflowRuns({
        workflow_id,
        branch: ref,
        repo: repoName,
        event: 'workflow_dispatch',
        per_page: perPage,
      });

      const runs = res.runs || [];

      // Filter plausible runs: prefer exact head_sha match, else use created_at close to dispatchTime
      let candidates = runs.filter((r: any) => !!r.id);

      if (commitSha) {
        const bySha = candidates.filter((r: any) => r.head_sha && r.head_sha === commitSha);
        if (bySha.length > 0) {
          // choose the most recent matching sha
          candidates = bySha;
        }
      }

      if (candidates.length > 0) {
        // choose run with created_at nearest to dispatchTime (prefer newer)
        candidates.sort((a: any, b: any) => {
          const ta = new Date(a.created_at).getTime();
          const tb = new Date(b.created_at).getTime();
          // prefer closer to dispatchTime, and prefer newer if equal
          const da = Math.abs(ta - dispatchTimeMs);
          const db = Math.abs(tb - dispatchTimeMs);
          if (da === db) return tb - ta;
          return da - db;
        });

        foundRunId = candidates[0].id as number;
        break;
      }

      attempt++;
      const waitMs = Math.min(1000 * Math.pow(2, Math.min(attempt, 5)), 10000);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  } catch (e) {
    // ignore - best-effort
  }

  const record = {
    run_id: foundRunId,
    workflow_id,
    ref,
    startedAt: dispatchIso,
    status: foundRunId ? 'found' : 'pending',
    commitSha,
  } as any;

  // Try to persist to repository file (.botcow/ci-runs.json) in the dedicated branch
  let stored: 'repo' | 'local' = 'local';

  try {
    // read existing store (if any)
    let data: Record<string, any> = {};
    try {
      const raw = await getFile(STORE_PATH, repo, STORE_COMMIT_BRANCH);
      data = JSON.parse(raw || '{}');
    } catch (err: any) {
      // if not found (404) we'll create new
      // console.warn('ciRunner: store file read failed', err?.message || err);
    }

    data[repo] = record;

    await commitFile({
      path: STORE_PATH,
      content: JSON.stringify(data, null, 2),
      message: `chore(ci): record workflow run ${workflow_id} ${foundRunId ?? 'pending'}`,
      branch: STORE_COMMIT_BRANCH,
      repo,
    });

    stored = 'repo';
  } catch (err: any) {
    // If commit fails (permissions etc) — fallback to local store
    // console.warn('ciRunner: commit to repo failed, fallback to local store', err?.message || err);
    try {
      await saveRun(repo, {
        run_id: record.run_id,
        workflow_id: record.workflow_id,
        ref: record.ref,
        startedAt: record.startedAt,
        status: record.status,
      });
    } catch (e) {
      // swallow
    }
    stored = 'local';
  }

  const tracked: RunTrackResult = {
    runId: foundRunId,
    workflowId: workflow_id,
    ref,
    startedAt: dispatchIso,
    stored,
    commitSha,
  };

  return { result: dispatchResult, tracked };
}

/**
 * Получить статус запуска workflow, с обработкой ошибок прав доступа/не найдено.
 */
export async function getWorkflowRunStatus(args: { run_id: number; repo?: string }) {
  try {
    const data = await getWorkflowStatus(args);
    // normalize subset of useful fields
    const normalized = {
      run_id: data.id,
      status: data.status,
      conclusion: data.conclusion,
      created_at: data.created_at,
      updated_at: data.updated_at,
      html_url: data.html_url,
      head_branch: data.head_branch,
      head_sha: data.head_sha,
      run_number: data.run_number,
      name: data.name,
      event: data.event,
    };
    return normalized;
  } catch (err: any) {
    const status = err?.status;
    if (status === 401 || status === 403) {
      throw new Error('GitHub API access denied: token lacks Actions/workflow permissions (401/403)');
    }
    if (status === 404) {
      throw new Error('Workflow run not found (404). Possibly wrong run_id or token lacks access');
    }
    throw err;
  }
}
