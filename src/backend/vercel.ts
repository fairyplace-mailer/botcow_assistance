const VERCEL_API_BASE = 'https://api.vercel.com';

const defaultProjectId = process.env.VERCEL_PROJECT_ID;
const defaultTeamId = process.env.VERCEL_TEAM_ID;

export type VercelTarget = 'production' | 'preview';

export type VercelContext = {
  projectId?: string;
  teamId?: string;
  /**
   * Default git ref (branch) to use when triggering a deploy with gitSha.
   * This is needed because different repos may have different default branches.
   */
  gitRef?: string;
};

function getVercelTokenOrThrow(): string {
  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    throw new Error('VERCEL_TOKEN is not set');
  }
  return token;
}

function buildHeaders() {
  const token = getVercelTokenOrThrow();
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function withTeam(url: URL, teamId?: string) {
  const tid = teamId ?? defaultTeamId;
  if (tid) {
    url.searchParams.set('teamId', tid);
  }
}

function resolveProjectId(ctx?: VercelContext): string | undefined {
  return ctx?.projectId ?? defaultProjectId;
}

function resolveGitRef(ctx?: VercelContext): string {
  return ctx?.gitRef ?? 'main';
}

export async function getLatestDeployments(
  env: VercelTarget | 'all' = 'production',
  ctx?: VercelContext,
  limit = 5,
) {
  const url = new URL('/v6/deployments', VERCEL_API_BASE);

  const projectId = resolveProjectId(ctx);
  if (projectId) {
    url.searchParams.set('projectId', projectId);
  }

  withTeam(url, ctx?.teamId);
  url.searchParams.set('limit', String(limit));

  if (env === 'production') {
    url.searchParams.set('target', 'production');
  } else if (env === 'preview') {
    url.searchParams.set('target', 'preview');
  }

  const res = await fetch(url, { headers: buildHeaders() });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vercel getLatestDeployments failed: ${res.status} ${text}`);
  }

  return res.json();
}

export async function getDeploymentStatus(
  deploymentId: string,
  ctx?: VercelContext,
) {
  const url = new URL(`/v13/deployments/${deploymentId}`, VERCEL_API_BASE);
  withTeam(url, ctx?.teamId);

  const res = await fetch(url, { headers: buildHeaders() });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vercel getDeploymentStatus failed: ${res.status} ${text}`);
  }

  return res.json();
}

export async function triggerDeploy(
  projectIdOverride?: string,
  gitSha?: string,
  target: VercelTarget = 'production',
  ctx?: VercelContext,
) {
  const pid = projectIdOverride ?? resolveProjectId(ctx);

  if (!pid) {
    throw new Error('VERCEL_PROJECT_ID is not set');
  }

  const url = new URL('/v13/deployments', VERCEL_API_BASE);
  withTeam(url, ctx?.teamId);

  // Vercel Deployments API requires `files` to be an array.
  // We don't upload files here (we trigger a build from gitSource), so we pass an empty array.
  const body: any = {
    name: pid,
    project: pid,
    target,
    files: [],
  };

  if (gitSha) {
    body.gitSource = {
      type: 'github',
      ref: resolveGitRef(ctx),
      sha: gitSha,
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vercel triggerDeploy failed: ${res.status} ${text}`);
  }

  return res.json();
}

export async function redeploy(
  deploymentId: string,
  target: VercelTarget = 'production',
  ctx?: VercelContext,
) {
  const projectId = resolveProjectId(ctx);
  if (!projectId) {
    throw new Error('VERCEL_PROJECT_ID is not set');
  }

  const url = new URL('/v13/deployments', VERCEL_API_BASE);
  withTeam(url, ctx?.teamId);

  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({
      name: projectId,
      project: projectId,
      target,
      deploymentId,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vercel redeploy failed: ${res.status} ${text}`);
  }

  return res.json();
}

export type FindDeploymentByGitArgs = {
  gitSha: string;
  target?: VercelTarget;
  branch?: string;
  // time window in minutes for fallback
  timeWindowMinutes?: number;
  limit?: number;
};

export type FoundDeployment = {
  deployment: any;
  matchedBy: 'sha' | 'branch_time_window' | 'latest';
};

function getDeploymentGitMeta(depl: any):
  | {
      sha?: string;
      ref?: string;
    }
  | undefined {
  const meta = depl?.meta;
  if (!meta || typeof meta !== 'object') return undefined;
  const sha =
    typeof (meta as any).githubCommitSha === 'string'
      ? (meta as any).githubCommitSha
      : typeof (meta as any).gitSha === 'string'
        ? (meta as any).gitSha
        : undefined;
  const ref =
    typeof (meta as any).githubCommitRef === 'string'
      ? (meta as any).githubCommitRef
      : typeof (meta as any).gitBranch === 'string'
        ? (meta as any).gitBranch
        : undefined;
  return { sha, ref };
}

export async function findDeploymentByGit(
  args: FindDeploymentByGitArgs,
  ctx?: VercelContext,
): Promise<FoundDeployment | null> {
  const target = args.target ?? 'preview';
  const limit = args.limit ?? 20;

  const data = await getLatestDeployments(target, ctx, limit);
  const deployments = Array.isArray((data as any).deployments)
    ? (data as any).deployments
    : [];

  // 1) exact match by sha
  for (const d of deployments) {
    const meta = getDeploymentGitMeta(d);
    if (meta?.sha && meta.sha.toLowerCase() === args.gitSha.toLowerCase()) {
      return { deployment: d, matchedBy: 'sha' };
    }
  }

  // 2) fallback by branch + time window
  if (args.branch) {
    const windowMin = args.timeWindowMinutes ?? 180;
    const now = Date.now();
    const minTs = now - windowMin * 60 * 1000;

    for (const d of deployments) {
      const meta = getDeploymentGitMeta(d);
      const createdAt: number | undefined =
        typeof d?.createdAt === 'number'
          ? d.createdAt
          : typeof d?.created === 'number'
            ? d.created
            : undefined;

      if (!createdAt) continue;
      if (createdAt < minTs) continue;

      if (meta?.ref && meta.ref === args.branch) {
        return { deployment: d, matchedBy: 'branch_time_window' };
      }
    }
  }

  // 3) last resort: latest
  if (deployments.length > 0) {
    return { deployment: deployments[0], matchedBy: 'latest' };
  }

  return null;
}
