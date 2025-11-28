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

export async function getFile(path: string, repo: string = defaultRepo as string) {
  const { owner, repo: repoName } = parseRepo(repo);
  const res = await github.repos.getContent({
    owner,
    repo: repoName,
    path,
  });

  if (!('content' in res.data)) {
    throw new Error(`Not a file: ${path}`);
  }

  const raw = Buffer.from(res.data.content, 'base64').toString('utf8');
  return raw;
}

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

  const params: Parameters<typeof github.repos.createOrUpdateFileContents>[0] = {
    owner,
    repo,
    path,
    message,
    content: encoded,
    branch,
  };

  if (sha) {
    (params as any).sha = sha;
  }

  const result = await github.repos.createOrUpdateFileContents(params);
  return result.data;
}

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

  const params: Parameters<typeof github.pulls.create>[0] = {
    owner,
    repo,
    title,
    head,
    base,
  };

  if (options.body) {
    (params as any).body = options.body;
  }

  const pr = await github.pulls.create(params);
  return pr.data;
}

export async function mergePullRequest(options: {
  pull_number: number;
  repo?: string;
}) {
  const repoName = options.repo ?? (defaultRepo as string);
  const { owner, repo } = parseRepo(repoName);

  const result = await github.pulls.merge({
    owner,
    repo,
    pull_number: options.pull_number,
  });

  return result.data;
}

// запустить workflow (по умолчанию ci.yml на main)
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

  const params: Parameters<typeof github.actions.createWorkflowDispatch>[0] = {
    owner,
    repo,
    workflow_id,
    ref,
  };

  if (options.inputs) {
    (params as any).inputs = options.inputs as { [key: string]: unknown };
  }

  await github.actions.createWorkflowDispatch(params);

  return { dispatched: true, workflow_id, ref };
}

// получить статус конкретного запуска CI
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
