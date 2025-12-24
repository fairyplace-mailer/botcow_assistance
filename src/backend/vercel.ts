import {
  normalizeVercelDeployment,
  type NormalizedVercelDeployment,
  type VercelTarget,
} from './vercelNormalize';

export type { VercelTarget };

function getVercelTokenOrThrow(): string {
  const token = process.env.VERCEL_TOKEN;
  if (!token) throw new Error('VERCEL_TOKEN is not set');
  return token;
}

export type VercelContext = {
  projectId?: string;
  teamId?: string;
  /** Git ref (branch) for deployments created via gitSource */
  gitRef?: string;
};

function buildUrl(path: string, ctx?: VercelContext) {
  const url = new URL(`https://api.vercel.com${path}`);
  const teamId = ctx?.teamId ?? process.env.VERCEL_TEAM_ID;
  if (teamId) url.searchParams.set('teamId', teamId);
  return url;
}

async function vercelFetchJson<T>(
  path: string,
  init: RequestInit,
  ctx?: VercelContext,
): Promise<T> {
  const token = getVercelTokenOrThrow();
  const url = buildUrl(path, ctx);

  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Vercel ${init.method ?? 'GET'} ${path} failed: ${res.status} ${text}`,
    );
  }

  return (await res.json()) as T;
}

export async function getLatestDeployments(
  target: VercelTarget,
  ctx?: VercelContext,
  limit = 20,
): Promise<NormalizedVercelDeployment[]> {
  const projectId = ctx?.projectId ?? process.env.VERCEL_PROJECT_ID;

  const search = new URLSearchParams();
  search.set('limit', String(limit));
  if (projectId) search.set('projectId', projectId);
  if (target) search.set('target', target);

  const data = await vercelFetchJson<{ deployments: any[] }>(
    `/v6/deployments?${search.toString()}`,
    { method: 'GET' },
    ctx,
  );

  return (data.deployments ?? []).map(normalizeVercelDeployment);
}

export async function getDeploymentStatus(
  deploymentId: string,
  ctx?: VercelContext,
): Promise<NormalizedVercelDeployment> {
  const data = await vercelFetchJson<any>(
    `/v13/deployments/${deploymentId}`,
    { method: 'GET' },
    ctx,
  );
  return normalizeVercelDeployment(data);
}

function resolveGitRef(ctx?: VercelContext) {
  return ctx?.gitRef || 'main';
}

export async function triggerDeploy(
  projectIdOverride: string | undefined,
  gitSha: string | undefined,
  // preview only per spec
  _target: VercelTarget,
  ctx?: VercelContext,
): Promise<NormalizedVercelDeployment> {
  const projectId = projectIdOverride ?? ctx?.projectId ?? process.env.VERCEL_PROJECT_ID;
  if (!projectId) throw new Error('Vercel projectId is not configured');

  // Vercel Deployments API requires "files" field to be an array.
  // For preview deploys, do NOT send "target".
  const body: any = {
    name: 'botcow-triggered-deploy',
    project: projectId,
    files: [],
  };

  if (gitSha) {
    body.gitSource = {
      type: 'github',
      ref: resolveGitRef(ctx),
      sha: gitSha,
    };
  }

  const data = await vercelFetchJson<any>(
    `/v13/deployments`,
    { method: 'POST', body: JSON.stringify(body) },
    ctx,
  );

  return normalizeVercelDeployment(data);
}

export async function redeploy(
  deploymentId: string,
  // preview only per spec
  _target: VercelTarget,
  ctx?: VercelContext,
): Promise<NormalizedVercelDeployment> {
  // For preview redeploys, do NOT send "target".
  const body: any = {
    deploymentId,
  };

  const data = await vercelFetchJson<any>(
    `/v13/deployments`,
    { method: 'POST', body: JSON.stringify(body) },
    ctx,
  );

  return normalizeVercelDeployment(data);
}

export async function findDeploymentByGit(
  opts: {
    gitSha?: string;
    target?: VercelTarget;
    branch?: string;
    timeWindowMinutes?: number;
    limit?: number;
  },
  ctx?: VercelContext,
): Promise<NormalizedVercelDeployment | null> {
  const {
    gitSha,
    target = 'preview',
    branch,
    timeWindowMinutes = 120,
    limit = 50,
  } = opts;

  const deployments = await getLatestDeployments(target, ctx, limit);
  if (!deployments.length) return null;

  if (gitSha) {
    const bySha = deployments.find((d) => {
      const meta = d.meta ?? {};
      const sha =
        (typeof (meta as any).githubCommitSha === 'string' && (meta as any).githubCommitSha) ||
        (typeof (meta as any).gitSha === 'string' && (meta as any).gitSha) ||
        '';
      return sha.toLowerCase() === gitSha.toLowerCase();
    });
    if (bySha) return bySha;
  }

  if (branch) {
    const now = Date.now();
    const windowMs = timeWindowMinutes * 60 * 1000;
    const byBranchAndTime = deployments.find((d) => {
      const createdAtMs = d.createdAt ? new Date(d.createdAt).getTime() : 0;
      const within = Math.abs(now - createdAtMs) <= windowMs;
      const meta = d.meta ?? {};
      const b =
        (typeof (meta as any).githubCommitRef === 'string' && (meta as any).githubCommitRef) ||
        (typeof (meta as any).gitRef === 'string' && (meta as any).gitRef) ||
        '';
      return within && b === branch;
    });
    if (byBranchAndTime) return byBranchAndTime;
  }

  return deployments[0] ?? null;
}
