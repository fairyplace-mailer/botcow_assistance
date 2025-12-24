import { Octokit } from '@octokit/rest';
import { getDefaultRepoFromConfig, isRepoAllowed } from './config/repos';
import { logEvent } from './log';

let githubClient: Octokit | null = null;

function getGithubToken(): string {
  const token = process.env.GITHUB_PAT_BOTCOW;
  if (!token) {
    // IMPORTANT: do not throw at module import time.
    // Next.js may evaluate route modules during build/"collect page data".
    throw new Error('GITHUB_PAT_BOTCOW is not set');
  }
  return token;
}

export function getGithubClient(): Octokit {
  if (githubClient) return githubClient;
  githubClient = new Octokit({ auth: getGithubToken() });
  return githubClient;
}

function getDefaultRepo(): string {
  // Source of truth: config/repos.yml
  return getDefaultRepoFromConfig();
}

export function parseRepo(repo?: string) {
  const resolved = repo ?? getDefaultRepo();

  // Safety: restrict to allowlist from config
  if (!isRepoAllowed(resolved)) {
    throw new Error(
      `Repo is not allowed by config: ${resolved}. Add it to config/repos.yml`,
    );
  }

  const [owner, repoName] = resolved.split('/');
  if (!owner || !repoName) {
    throw new Error(`Invalid repo: ${resolved}`);
  }
  return { owner, repo: repoName, fullName: resolved };
}

export type NormalizedRun = {
  id: number;
  status: string | null;
  conclusion: string | null;
  head_branch?: string | null;
  head_sha?: string | null;
  created_at?: string | null;
  html_url?: string | null;
  run_number?: number | null;
  name?: string | null;
  event?: string | null;
  workflow_id?: number | null;
};

export type NormalizedJob = {
  id: number;
  name: string;
  status: string | null;
  conclusion: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  html_url?: string | null;
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function normalizeQuery(q: string) {
  return q.trim().replace(/\s+/g, ' ');
}

function buildSearchQuery(args: {
  query: string;
  owner: string;
  repo: string;
  path?: string;
}) {
  const baseQuery = normalizeQuery(args.query);

  // Avoid duplicating repo/path qualifiers if caller already inserted them.
  const hasRepoQualifier = /(^|\s)repo:/.test(baseQuery);
  const hasPathQualifier = /(^|\s)path:/.test(baseQuery);

  let q = baseQuery;
  if (!hasRepoQualifier) {
    q += ` repo:${args.owner}/${args.repo}`;
  }
  if (args.path && !hasPathQualifier) {
    q += ` path:${args.path}`;
  }

  return q;
}

type SearchCodeParams = {
  q: string;
  per_page: number;
  page: number;
};

function getHeaderValue(headers: any, name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  return headers[name] ?? headers[lower];
}

function isSecondaryRateLimitError(error: any): boolean {
  const msg =
    (typeof error?.message === 'string' ? error.message : '') +
    ' ' +
    (typeof error?.response?.data?.message === 'string'
      ? error.response.data.message
      : '');
  return /secondary rate limit/i.test(msg);
}

async function searchCodeWithRetry(params: SearchCodeParams) {
  const maxRetries = 4;
  const github = getGithubClient();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await github.search.code({
        q: params.q,
        per_page: params.per_page,
        page: params.page,
      });
    } catch (error: any) {
      const status = error?.status ?? error?.response?.status;
      const headers = error?.response?.headers;

      const remainingStr = getHeaderValue(headers, 'x-ratelimit-remaining');
      const resetStr = getHeaderValue(headers, 'x-ratelimit-reset');
      const remaining =
        remainingStr !== undefined ? Number.parseInt(remainingStr, 10) : undefined;
      const resetSec =
        resetStr !== undefined ? Number.parseInt(resetStr, 10) : undefined;

      const isRateLimitExceeded = status === 403 && remaining === 0;
      const isSecondary = status === 403 && isSecondaryRateLimitError(error);

      if (attempt >= maxRetries || (!isRateLimitExceeded && !isSecondary)) {
        throw error;
      }

      if (isRateLimitExceeded && resetSec) {
        const resetMs = resetSec * 1000;
        const now = Date.now();
        const jitterMs = 100 + Math.floor(Math.random() * 400);
        const waitMs = Math.max(0, resetMs - now) + jitterMs;

        // Best-effort: do not break the request if logging fails.
        try {
          await logEvent('github_search_rate_limited_wait', {
            attempt,
            waitMs,
            remaining,
            resetSec,
          });
        } catch {
          // ignore
        }

        await sleep(waitMs);
        continue;
      }

      // Secondary rate limit / abuse detection fallback
      const backoffMs = Math.min(20000, 1000 * 2 ** attempt);
      try {
        await logEvent('github_search_secondary_rate_limit_backoff', {
          attempt,
          backoffMs,
        });
      } catch {
        // ignore
      }
      await sleep(backoffMs);
    }
  }

  // Unreachable due to throw/return in loop.
  throw new Error('searchCodeWithRetry: exhausted');
}

const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const SEARCH_CACHE_MAX_ENTRIES = 300;

type SearchInRepoResultItem = {
  path: string;
  repository: string;
  score: number;
  url: string;
};

const searchCache = new Map<
  string,
  { expiresAt: number; data: SearchInRepoResultItem[] }
>();
const searchInflight = new Map<string, Promise<SearchInRepoResultItem[]>>();

/**
 * Test-only helper to make unit tests deterministic.
 * Not used in runtime code.
 */
export function __resetSearchStateForTests() {
  searchCache.clear();
  searchInflight.clear();
}

function purgeExpiredSearchCache() {
  const now = Date.now();
  for (const [k, v] of searchCache.entries()) {
    if (v.expiresAt <= now) searchCache.delete(k);
  }
  // Basic LRU-ish cap: delete oldest inserted keys (Map preserves insertion order).
  while (searchCache.size > SEARCH_CACHE_MAX_ENTRIES) {
    const firstKey = searchCache.keys().next().value as string | undefined;
    if (!firstKey) break;
    searchCache.delete(firstKey);
  }
}

export async function getFile(path: string, repo?: string, ref?: string) {
  const github = getGithubClient();
  const { owner, repo: repoName } = parseRepo(repo);

  const params: Parameters<typeof github.repos.getContent>[0] = {
    owner,
    repo: repoName,
    path,
  };

  if (ref) {
    (params as any).ref = ref;
  }

  const res = await github.repos.getContent(params);

  if (!('content' in res.data)) {
    throw new Error(`Not a file: ${path}`);
  }

  const raw = Buffer.from(res.data.content, 'base64').toString('utf8');
  return raw;
}

export async function getRepoStructure(options?: {
  repo?: string;
  ref?: string;
  pathPrefix?: string;
}) {
  const github = getGithubClient();
  const { owner, repo } = parseRepo(options?.repo);

  let ref = options?.ref;

  if (!ref) {
    const repoInfo = await github.repos.get({ owner, repo });
    ref = repoInfo.data.default_branch || 'main';
  }

  const treeRes = await github.git.getTree({
    owner,
    repo,
    tree_sha: ref,
    recursive: '1',
  });

  const prefix = options?.pathPrefix?.replace(/\/+$/, '');
  const items = (treeRes.data.tree || [])
    .filter((item) => !!item.path)
    .filter((item) =>
      prefix ? item.path!.startsWith(`${prefix}/`) || item.path === prefix : true,
    )
    .map((item) => ({
      path: item.path!,
      type: item.type,
      mode: item.mode,
      size: item.size,
      sha: item.sha,
      url: item.url,
    }));

  return {
    ref,
    items,
  };
}

export async function listFiles(options?: {
  path?: string;
  repo?: string;
  ref?: string;
}) {
  const github = getGithubClient();
  const { owner, repo } = parseRepo(options?.repo);
  const path = options?.path ?? '';

  const params: Parameters<typeof github.repos.getContent>[0] = {
    owner,
    repo,
    path,
  };

  if (options?.ref) {
    (params as any).ref = options.ref;
  }

  const res = await github.repos.getContent(params);

  if (Array.isArray(res.data)) {
    return res.data.map((item) => ({
      path: item.path,
      name: item.name,
      type: item.type,
      size: item.size,
      sha: item.sha,
    }));
  }

  return [
    {
      path: res.data.path,
      name: res.data.name,
      type: res.data.type,
      size: 'size' in res.data ? res.data.size : undefined,
      sha: 'sha' in res.data ? res.data.sha : undefined,
    },
  ];
}

export async function searchInRepo(options: {
  query: string;
  path?: string;
  repo?: string;
  per_page?: number;
  page?: number;
}): Promise<SearchInRepoResultItem[]> {
  const { owner, repo } = parseRepo(options.repo);

  const per_page = clampInt(options.per_page, 1, 50, 20);
  const page = clampInt(options.page, 1, 5, 1);

  const q = buildSearchQuery({
    query: options.query,
    owner,
    repo,
    ...(options.path ? { path: options.path } : {}),
  });

  purgeExpiredSearchCache();

  const cacheKey = `${q}::per_page=${per_page}::page=${page}`;

  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    try {
      await logEvent('github_search_cache_hit', {
        page,
        per_page,
      });
    } catch {
      // ignore
    }
    return cached.data;
  }

  const inflight = searchInflight.get(cacheKey);
  if (inflight) {
    try {
      await logEvent('github_search_inflight_join', {
        page,
        per_page,
      });
    } catch {
      // ignore
    }
    return inflight;
  }

  const promise = (async () => {
    const res = await searchCodeWithRetry({ q, per_page, page });

    const items: SearchInRepoResultItem[] = res.data.items.map((item) => ({
      path: item.path,
      repository: item.repository.full_name,
      score: item.score,
      url: item.html_url,
    }));

    searchCache.set(cacheKey, {
      expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
      data: items,
    });

    purgeExpiredSearchCache();

    return items;
  })();

  searchInflight.set(cacheKey, promise);

  try {
    return await promise;
  } finally {
    searchInflight.delete(cacheKey);
  }
}

export async function getRecentCommits(options?: {
  branch?: string;
  limit?: number;
  repo?: string;
}) {
  const github = getGithubClient();
  const { owner, repo } = parseRepo(options?.repo);
  const branch = options?.branch;
  const limit = options?.limit ?? 20;

  const params: Parameters<typeof github.repos.listCommits>[0] = {
    owner,
    repo,
    per_page: limit,
  };

  if (branch) {
    (params as any).sha = branch;
  }

  const res = await github.repos.listCommits(params);

  return res.data.map((commit) => ({
    sha: commit.sha,
    author: commit.commit.author?.name,
    email: commit.commit.author?.email,
    date: commit.commit.author?.date,
    message: commit.commit.message,
    url: commit.html_url,
  }));
}

export async function createBranch(
  branchName: string,
  baseBranch: string = 'main',
  repoName?: string,
) {
  const github = getGithubClient();
  const { owner, repo } = parseRepo(repoName);

  const baseRef = await github.git.getRef({
    owner,
    repo,
    ref: `heads/${baseBranch}`,
  });

  const sha = baseRef.data.object.sha;

  try {
    const ref = await github.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha,
    });

    return ref.data;
  } catch (error: any) {
    if (error?.status === 422) {
      return { error: 'branch-already-exists', branch: branchName, baseSha: sha };
    }
    throw error;
  }
}

export async function commitFile(options: {
  path: string;
  content: string;
  message: string;
  branch: string;
  repo?: string;
}) {
  const github = getGithubClient();
  const { path, content, message, branch } = options;
  const { owner, repo } = parseRepo(options.repo);

  let sha: string | undefined;

  try {
    const res = await github.repos.getContent({
      owner,
      repo,
      path,
      ref: branch,
    });

    if ('sha' in res.data) {
      sha = (res.data as any).sha;
    }
  } catch (error: any) {
    if (error?.status !== 404) {
      throw error;
    }
  }

  const encoded = Buffer.from(content, 'utf8').toString('base64');

  const params: {
    owner: string;
    repo: string;
    path: string;
    message: string;
    content: string;
    branch: string;
    sha?: string;
  } = {
    owner,
    repo,
    path,
    message,
    content: encoded,
    branch,
  };

  if (sha) {
    params.sha = sha;
  }

  const result = await github.repos.createOrUpdateFileContents(params);
  return result.data;
}

export async function deleteFile(options: {
  path: string;
  message: string;
  branch: string;
  repo?: string;
}) {
  const github = getGithubClient();
  const { owner, repo } = parseRepo(options.repo);

  const { path, message, branch } = options;

  const res = await github.repos.getContent({
    owner,
    repo,
    path,
    ref: branch,
  });

  if (!('sha' in res.data)) {
    throw new Error(`Cannot delete non-file content: ${path}`);
  }

  const sha = (res.data as any).sha as string;

  const result = await github.repos.deleteFile({
    owner,
    repo,
    path,
    message,
    branch,
    sha,
  });

  return result.data;
}

export async function createPullRequest(options: {
  title: string;
  head: string;
  base?: string;
  body?: string;
  repo?: string;
}) {
  const github = getGithubClient();
  const { title, head } = options;
  const base = options.base ?? 'main';
  const { owner, repo } = parseRepo(options.repo);

  const params: {
    owner: string;
    repo: string;
    title: string;
    head: string;
    base: string;
    body?: string;
  } = {
    owner,
    repo,
    title,
    head,
    base,
  };

  if (options.body) {
    params.body = options.body;
  }

  const pr = await github.pulls.create(params);
  return pr.data;
}

export async function commentOnPullRequest(options: {
  pull_number: number;
  body: string;
  repo?: string;
}) {
  const github = getGithubClient();
  const { owner, repo } = parseRepo(options.repo);

  const res = await github.issues.createComment({
    owner,
    repo,
    issue_number: options.pull_number,
    body: options.body,
  });

  return res.data;
}

export async function mergePullRequest(options: {
  pull_number: number;
  method?: 'merge' | 'squash' | 'rebase';
  repo?: string;
}) {
  const github = getGithubClient();
  const { owner, repo } = parseRepo(options.repo);

  const res = await github.pulls.merge({
    owner,
    repo,
    pull_number: options.pull_number,
    merge_method: options.method ?? 'merge',
  });

  return res.data;
}

export async function runWorkflow(options: {
  workflow_id?: string;
  ref?: string;
  repo?: string;
  inputs?: Record<string, string>;
}) {
  const github = getGithubClient();
  const workflow_id = options.workflow_id ?? 'ci.yml';
  const ref = options.ref ?? 'main';
  const { owner, repo } = parseRepo(options.repo);

  const params: {
    owner: string;
    repo: string;
    workflow_id: string;
    ref: string;
    inputs?: Record<string, string>;
  } = {
    owner,
    repo,
    workflow_id,
    ref,
  };

  if (options.inputs) {
    params.inputs = options.inputs;
  }

  await github.actions.createWorkflowDispatch(params);

  return { dispatched: true, workflow_id, ref };
}

export async function getWorkflowStatus(options: {
  run_id: number;
  repo?: string;
}) {
  const github = getGithubClient();
  const { owner, repo } = parseRepo(options.repo);

  const run = await github.actions.getWorkflowRun({
    owner,
    repo,
    run_id: options.run_id,
  });

  return run.data;
}

export async function listWorkflowRunJobs(options: { run_id: number; repo?: string }) {
  const github = getGithubClient();
  const { owner, repo } = parseRepo(options.repo);

  const res = await github.actions.listJobsForWorkflowRun({
    owner,
    repo,
    run_id: options.run_id,
    per_page: 100,
  });

  const jobs = (res.data.jobs || []).map((j: any) => ({
    id: j.id,
    name: j.name,
    status: j.status ?? null,
    conclusion: j.conclusion ?? null,
    started_at: j.started_at ?? null,
    completed_at: j.completed_at ?? null,
    html_url: j.html_url ?? null,
  })) as NormalizedJob[];

  return { total_count: res.data.total_count, jobs };
}

export async function downloadWorkflowRunLogs(options: {
  run_id: number;
  repo?: string;
}): Promise<{ format: 'zip-base64'; contentBase64: string }> {
  const github = getGithubClient();
  const { owner, repo } = parseRepo(options.repo);

  const res = await github.actions.downloadWorkflowRunLogs({
    owner,
    repo,
    run_id: options.run_id,
  });

  const buf = Buffer.from(res.data as any);

  return { format: 'zip-base64', contentBase64: buf.toString('base64') };
}

export async function listWorkflowRunsForRepo(args: {
  workflow_id?: string | null | undefined;
  branch?: string | null | undefined;
  repo?: string | null | undefined;
  per_page?: number | null | undefined;
  event?: string | null | undefined;
  status?:
    | 'waiting'
    | 'completed'
    | 'action_required'
    | 'cancelled'
    | 'failure'
    | 'neutral'
    | 'skipped'
    | 'stale'
    | 'success'
    | 'timed_out'
    | 'in_progress'
    | 'queued'
    | 'requested'
    | 'pending'
    | null
    | undefined;
}) {
  const github = getGithubClient();
  const { workflow_id, branch, repo, per_page, event, status } = args;
  const { owner, repo: repoName } = parseRepo(repo ?? undefined);

  if (workflow_id) {
    const res = await github.actions.listWorkflowRuns({
      owner,
      repo: repoName,
      workflow_id: workflow_id as any,
      branch: branch ?? undefined,
      event: event ?? undefined,
      status: status ?? undefined,
      per_page: per_page ?? 10,
    });

    const runs = (res.data.workflow_runs || []).map((r: any) => ({
      id: r.id,
      status: r.status ?? null,
      conclusion: r.conclusion ?? null,
      head_branch: r.head_branch ?? null,
      head_sha: r.head_sha ?? null,
      created_at: r.created_at ?? null,
      html_url: r.html_url ?? null,
      run_number: r.run_number ?? null,
      name: r.name ?? null,
      event: r.event ?? null,
      workflow_id: r.workflow_id ?? null,
    }));

    return { total_count: res.data.total_count, runs };
  }

  const res = await github.actions.listWorkflowRunsForRepo({
    owner,
    repo: repoName,
    branch: branch ?? undefined,
    event: event ?? undefined,
    status: status ?? undefined,
    per_page: per_page ?? 10,
  });

  const runs = (res.data.workflow_runs || []).map((r: any) => ({
    id: r.id,
    status: r.status ?? null,
    conclusion: r.conclusion ?? null,
    head_branch: r.head_branch ?? null,
    head_sha: r.head_sha ?? null,
    created_at: r.created_at ?? null,
    html_url: r.html_url ?? null,
    run_number: r.run_number ?? null,
    name: r.name ?? null,
    event: r.event ?? null,
    workflow_id: r.workflow_id ?? null,
  }));

  return { total_count: res.data.total_count, runs };
}

export async function createIssue(options: {
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
  repo?: string;
}) {
  const github = getGithubClient();
  const { owner, repo } = parseRepo(options.repo);

  const params: any = {
    owner,
    repo,
    title: options.title,
  };

  if (options.body !== undefined) {
    params.body = options.body;
  }
  if (options.labels !== undefined) {
    params.labels = options.labels;
  }
  if (options.assignees !== undefined) {
    params.assignees = options.assignees;
  }

  const res = await github.issues.create(params);
  return res.data;
}

export async function updateIssue(options: {
  issue_number: number;
  title?: string;
  body?: string;
  state?: 'open' | 'closed';
  labels?: string[];
  assignees?: string[];
  repo?: string;
}) {
  const github = getGithubClient();
  const { owner, repo } = parseRepo(options.repo);

  const params: any = {
    owner,
    repo,
    issue_number: options.issue_number,
  };

  if (options.title !== undefined) {
    params.title = options.title;
  }
  if (options.body !== undefined) {
    params.body = options.body;
  }
  if (options.state !== undefined) {
    params.state = options.state;
  }
  if (options.labels !== undefined) {
    params.labels = options.labels;
  }
  if (options.assignees !== undefined) {
    params.assignees = options.assignees;
  }

  const res = await github.issues.update(params);
  return res.data;
}

export async function listIssues(options?: {
  state?: 'open' | 'closed' | 'all';
  labels?: string[];
  repo?: string;
  per_page?: number;
}) {
  const github = getGithubClient();
  const { owner, repo } = parseRepo(options?.repo);

  const params: any = {
    owner,
    repo,
    state: options?.state ?? 'open',
    per_page: options?.per_page ?? 30,
  };

  if (options?.labels !== undefined) {
    params.labels = options.labels;
  }

  const res = await github.issues.listForRepo(params);

  return res.data.map((issue) => ({
    number: issue.number,
    title: issue.title,
    state: issue.state,
    labels: issue.labels
      ?.map((l) => (typeof l === 'string' ? l : l.name))
      .filter(Boolean),
    url: issue.html_url,
  }));
}

// Alias export to ensure bundlers that rely on static names see both variants
export const listWorkflowRuns = listWorkflowRunsForRepo;
