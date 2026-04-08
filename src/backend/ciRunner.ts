import {
  commitFile,
  getFile,
  getRecentCommits,
  getWorkflowStatus,
  listWorkflowRuns,
  runWorkflow,
} from './github';
import {
  getTrackedWorkflowRunFromStore,
  saveRun,
  setTrackedWorkflowRunForTests,
} from './ciStore';

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

let delayForTests: ((ms: number) => Promise<void>) | null = null;

export function __setDelayForTests(fn: (ms: number) => Promise<void>) {
  delayForTests = fn;
}

export function __resetDelayForTests() {
  delayForTests = null;
}

function delay(ms: number) {
  if (delayForTests) return delayForTests(ms);
  return Promise.resolve();
}

export async function runWorkflowAndTrack(options: {
  workflow_id?: string;
  ref?: string;
  repo?: string;
  inputs?: Record<string, string>;
  startedAt?: string;
}) {
  const workflow_id = options.workflow_id ?? 'ci.yml';
  const ref = options.ref ?? 'main';
  const repo = options.repo ?? process.env.BOTCOW_DEFAULT_REPO!;

  const dispatchTime = options.startedAt ? new Date(options.startedAt) : new Date();
  const dispatchIso = dispatchTime.toISOString();

  let commitSha: string | null = null;
  try {
    const commits = await getRecentCommits({ branch: ref, limit: 1, repo });
    if (
      Array.isArray(commits) &&
      commits.length > 0 &&
      commits[0] &&
      typeof (commits[0] as any).sha === 'string'
    ) {
      commitSha = (commits[0] as any).sha as string;
    }
  } catch {
    // best-effort — continue without commitSha
  }

  const dispatchParams: {
    workflow_id: string;
    ref: string;
    repo: string;
    inputs?: Record<string, string>;
  } = {
    workflow_id,
    ref,
    repo,
  };
  if (options.inputs) {
    dispatchParams.inputs = options.inputs;
  }

  const dispatchResult = await runWorkflow(dispatchParams);

  let foundRunId: number | null = null;

  try {
    const maxAttempts = 20;
    let attempt = 0;
    const perPage = 10;

    const dispatchTimeMs = dispatchTime.getTime();

    while (attempt < maxAttempts) {
      const res = await listWorkflowRuns({
        workflow_id,
        branch: ref,
        repo,
        event: 'workflow_dispatch',
        per_page: perPage,
      });

      const runs = res.runs || [];
      let candidates = runs.filter((r: any) => !!r.id);

      if (commitSha) {
        const bySha = candidates.filter((r: any) => r.head_sha && r.head_sha === commitSha);
        if (bySha.length > 0) {
          candidates = bySha;
        }
      }

      if (candidates.length > 0) {
        candidates.sort((a: any, b: any) => {
          const ta = new Date(a.created_at).getTime();
          const tb = new Date(b.created_at).getTime();
          const da = Math.abs(ta - dispatchTimeMs);
          const db = Math.abs(tb - dispatchTimeMs);
          if (da === db) return tb - ta;
          return da - db;
        });

        const first = candidates[0];
        if (first && typeof first.id === 'number') {
          foundRunId = first.id as number;
          setTrackedWorkflowRunForTests({
            runId: foundRunId,
            workflowId: workflow_id,
            ref,
            startedAt: dispatchIso,
            status: 'queued',
            repo,
            commitSha,
          });
        }
        break;
      }

      attempt += 1;
      const waitMs = Math.min(1000 * Math.pow(2, Math.min(attempt, 5)), 10000);
      await delay(waitMs);
    }
  } catch {
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

  let stored: 'repo' | 'local' = 'local';

  try {
    let data: Record<string, any> = {};
    try {
      const raw = await getFile(STORE_PATH, repo, STORE_COMMIT_BRANCH);
      data = JSON.parse(raw || '{}');
    } catch (err: any) {
      void err;
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
    void err;
    try {
      await saveRun(repo, {
        run_id: record.run_id,
        workflow_id: record.workflow_id,
        ref: record.ref,
        startedAt: record.startedAt,
        status: record.status,
      });
    } catch {
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

export function getTrackedWorkflowRun(runId: number) {
  return getTrackedWorkflowRunFromStore(runId);
}

export async function getWorkflowRunStatus(args: { run_id: number; repo?: string }) {
  try {
    const data = await getWorkflowStatus(args);
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
