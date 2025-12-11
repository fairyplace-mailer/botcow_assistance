import { Octokit } from '@octokit/rest';

const token = process.env.GITHUB_PAT_BOTCOW;
const defaultRepo = process.env.BOTCOW_DEFAULT_REPO;

if (!token) {
  throw new Error('GITHUB_PAT_BOTCOW is not set');
}

if (!defaultRepo) {
  throw new Error('BOTCOW_DEFAULT_REPO is not set');
}

export const github = new Octokit({
  auth: token,
});

export function parseRepo(repo: string = defaultRepo as string) {
  const [owner, repoName] = repo.split('/');
  if (!owner || !repoName) {
    throw new Error(`Invalid repo: ${repo}`);
  }
  return { owner, repo: repoName };
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

/**
 * Получить содержимое файла (UTF-8 текст) по пути.
 */
export async function getFile(
  path: string,
  repo: string = defaultRepo as string,
  ref?: string,
) {
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

/**
 * Получить структуру репозитория (дерево файлов).
 * Использует git tree с recursive=1.
 */
export async function getRepoStructure(options?: {
  repo?: string;
  ref?: string; // ветка или SHA, по умолчанию default_branch
  pathPrefix?: string; // фильтр по префиксу пути
}) {
  const repoName = options?.repo ?? (defaultRepo as string);
  const { owner, repo } = parseRepo(repoName);

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
      type: item.type, // 'blob' | 'tree' | ...
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

/**
 * Список файлов/папок по указанному пути (один уровень).
 */
export async function listFiles(options?: {
  path?: string;
  repo?: string;
  ref?: string;
}) {
  const repoName = options?.repo ?? (defaultRepo as string);
  const { owner, repo } = parseRepo(repoName);
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
      type: item.type, // 'file' | 'dir'
      size: item.size,
      sha: item.sha,
    }));
  }

  // если вернулся файл — оборачиваем в массив
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

/**
 * Поиск по коду в репозитории.
 */
export async function searchInRepo(options: {
  query: string;
  path?: string;
  repo?: string;
  per_page?: number;
}) {
  const repoName = options.repo ?? (defaultRepo as string);
  const { owner, repo } = parseRepo(repoName);
  const per_page = options.per_page ?? 20;

  let q = `${options.query} repo:${owner}/${repo}`;
  if (options.path) {
    q += ` path:${options.path}`;
  }

  const res = await github.search.code({
    q,
    per_page,
  });

  return res.data.items.map((item) => ({
    path: item.path,
    repository: item.repository.full_name,
    score: item.score,
    url: item.html_url,
  }));
}

/**
 * Последние коммиты по ветке.
 */
export async function getRecentCommits(options?: {
  branch?: string;
  limit?: number;
  repo?: string;
}) {
  const repoName = options?.repo ?? (defaultRepo as string);
  const { owner, repo } = parseRepo(repoName);
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

/**
 * Создать ветку от baseBranch.
 */
export async function createBranch(
  branchName: string,
  baseBranch: string = 'main',
  repo: string = defaultRepo as string,
) {
  const { owner, repo: repoName } = parseRepo(repo);

  const baseRef = await github.git.getRef({
    owner,
    repo: repoName,
    ref: `heads/${baseBranch}`,
  });

  const sha = baseRef.data.object.sha;

  try {
    const ref = await github.git.createRef({
      owner,
      repo: repoName,
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

/**
 * Создать или обновить файл (commit).
 */
export async function commitFile(options: {
  path: string;
  content: string;
  message: string;
  branch: string;
  repo?: string;
}) {
  const { path, content, message, branch } = options;
  const repoName = options.repo ?? (defaultRepo as string);
  const { owner, repo } = parseRepo(repoName);

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

/**
 * Удалить файл.
 */
export async function deleteFile(options: {
  path: string;
  message: string;
  branch: string;
  repo?: string;
}) {
  const repoName = options.repo ?? (defaultRepo as string);
  const { owner, repo } = parseRepo(repoName);

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

/**
 * Создать Pull Request.
 */
export async function createPullRequest(options: {
  title: string;
  head: string;
  base?: string;
  body?: string;
  repo?: string;
}) {
  const { title, head } = options;
  const base = options.base ?? 'main';
  const repoName = options.repo ?? (defaultRepo as string);
  const { owner, repo } = parseRepo(repoName);

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

/**
 * Оставить комментарий в PR (issues API).
 */
export async function commentOnPullRequest(options: {
  pull_number: number;
  body: string;
  repo?: string;
}) {
  const repoName = options.repo ?? (defaultRepo as string);
  const { owner, repo } = parseRepo(repoName);

  const res = await github.issues.createComment({
    owner,
    repo,
    issue_number: options.pull_number,
    body: options.body,
  });

  return res.data;
}

/**
 * Замёржить Pull Request выбранным методом.
 */
export async function mergePullRequest(options: {
  pull_number: number;
  method?: 'merge' | 'squash' | 'rebase';
  repo?: string;
}) {
  const repoName = options.repo ?? (defaultRepo as string);
  const { owner, repo } = parseRepo(repoName);

  const res = await github.pulls.merge({
    owner,
    repo,
    pull_number: options.pull_number,
    merge_method: options.method ?? 'merge',
  });

  return res.data;
}

/**
 * Запустить workflow (по умолчанию ci.yml на main).
 */
export async function runWorkflow(options: {
  workflow_id?: string;
  ref?: string;
  repo?: string;
  inputs?: Record<string, string>;
}) {
  const workflow_id = options.workflow_id ?? 'ci.yml';
  const ref = options.ref ?? 'main';
  const repoName = options.repo ?? (defaultRepo as string);
  const { owner, repo } = parseRepo(repoName);

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

/**
 * Получить статус конкретного запуска CI.
 */
export async function getWorkflowStatus(options: {
  run_id: number;
  repo?: string;
}) {
  const repoName = options.repo ?? (defaultRepo as string);
  const { owner, repo } = parseRepo(repoName);

  const run = await github.actions.getWorkflowRun({
    owner,
    repo,
    run_id: options.run_id,
  });

  return run.data;
}

/**
 * Список запусков workflow. Если указан workflow_id — использует
 * endpoint /actions/workflows/{workflow_id}/runs, иначе — /actions/runs.
 */
export async function listWorkflowRunsForRepo(args: {
  workflow_id?: string | null;
  branch?: string | null;
  repo?: string | null;
  per_page?: number | null;
  event?: string | null;
}) {
  const { workflow_id, branch, repo, per_page, event } = args;
  const { owner, repo: defaultRepoName } = parseRepo(repo ?? (defaultRepo as string));

  // Prefer workflow-specific endpoint when workflow_id provided
  if (workflow_id) {
    const res = await github.actions.listWorkflowRuns({
      owner,
      repo: defaultRepoName,
      workflow_id: workflow_id as any,
      branch: branch ?? undefined,
      event: event ?? undefined,
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

  // Fallback to repo-wide endpoint
  const res = await github.actions.listWorkflowRunsForRepo({
    owner,
    repo: defaultRepoName,
    branch: branch ?? undefined,
    event: event ?? undefined,
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

/**
 * Создать Issue.
 */
export async function createIssue(options: {
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
  repo?: string;
}) {
  const repoName = options.repo ?? (defaultRepo as string);
  const { owner, repo } = parseRepo(repoName);

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

/**
 * Обновить Issue.
 */
export async function updateIssue(options: {
  issue_number: number;
  title?: string;
  body?: string;
  state?: 'open' | 'closed';
  labels?: string[];
  assignees?: string[];
  repo?: string;
}) {
  const repoName = options.repo ?? (defaultRepo as string);
  const { owner, repo } = parseRepo(repoName);

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

/**
 * Список Issues по репозиторию.
 */
export async function listIssues(options?: {
  state?: 'open' | 'closed' | 'all';
  labels?: string[];
  repo?: string;
  per_page?: number;
}) {
  const repoName = options?.repo ?? (defaultRepo as string);
  const { owner, repo } = parseRepo(repoName);

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
