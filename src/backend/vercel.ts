import { normalizeVercelDeployment, type NormalizedVercelDeployment, type VercelTarget } from './vercelNormalize';

function getVercelTokenOrThrow(): string {
  const t = process.env.VERCEL_TOKEN;
  if (!t) throw new Error('VERCEL_TOKEN is not set');
  return t;
}

export type VercelContext = {
  projectId?: string;
  teamId?: string;
  /** Git ref (branch) used for gitSource deployments */
  gitRef?: string;
};

function buildHeaders() {
  const t = getVercelTokenOrThrow();
  return {
    Authorization: `Bearer ${t}`,
    'Content-Type': 'application/json',
  };
}

function buildUrl(
  path: string,
  ctx?: VercelContext,
  query?: Record<string, string | number | undefined>,
) {
  const url = new URL(`https://api.vercel.com${path}`);

  const teamId = ctx?.teamId ?? process.env.VERCEL_TEAM_ID;
  if (teamId) url.searchParams.set('teamId', teamId);

  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      url.searchParams.set(k, String(v));
    }
  }

  return url;
}

async function vercelFetchJson<T>(
  path: string,
  init: RequestInit,
  ctx?: VercelContext,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  const url = buildUrl(path, ctx, query);
  const res = await fetch(url, {
    ...init,
    headers: {
      ...buildHeaders(),
      ...(init.headers ?? {}),
    },
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Vercel ${init.method ?? 'GET'} ${path} failed: ${res.status} ${text}`);
  }

  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function getLatestDeployments(
  env: VercelTarget,
  ctx?: VercelContext,
  limit = 10,
): Promise<NormalizedVercelDeployment[]> {
  const projectId = ctx?.projectId ?? process.env.VERCEL_PROJECT_ID;

  const query: Record<string, string | number | undefined> = {
    limit,
    target: env,
  };
  if (projectId) query.projectId = projectId;

  const data = await vercelFetchJson<{ deployments: any[] }>(
    '/v6/deployments',
    { method: 'GET' },
    ctx,
    query,
  );

  return (data.deployments ?? []).map(normalizeVercelDeployment);
}

export async function getDeploymentStatus(
  deploymentId: string,
  ctx?: VercelContext,
): Promise<NormalizedVercelDeployment> {
  const data = await vercelFetchJson<any>(`/v13/deployments/${deploymentId}`, { method: 'GET' }, ctx);
  return normalizeVercelDeployment(data);
}

function resolveGitRef(ctx?: VercelContext): string {
  return ctx?.gitRef || 'main';
}

export async function triggerDeploy(
  projectIdOverride: string | undefined,
  gitSha: string | undefined,
  target: VercelTarget,
  ctx?: VercelContext,
): Promise<NormalizedVercelDeployment> {
  const project = projectIdOverride ?? ctx?.projectId ?? process.env.VERCEL_PROJECT_ID;
  if (!project) throw new Error('Vercel projectId is not set');

  // IMPORTANT:
  // Vercel Deployments API (POST /v13/deployments) does NOT accept target='preview'.
  // It accepts target='production' | 'staging' | custom environment id.
  // For preview deployments we must omit `target`.
  const body: any = {
    name: project,
    project,
    files: [],
  };

  if (target === 'production') {
    // Note: production is expected to be blocked at tool layer; this is a safety net.
    body.target = 'production';
  }

  if (gitSha) {
    body.gitSource = {
      type: 'github',
      ref: resolveGitRef(ctx),
      sha: gitSha,
    };
  }

  const data = await vercelFetchJson<any>(
    '/v13/deployments',
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    ctx,
  );

  return normalizeVercelDeployment(data);
}

export async function redeploy(
  deploymentId: string,
  target: VercelTarget,
  ctx?: VercelContext,
): Promise<NormalizedVercelDeployment> {
  const project = ctx?.projectId ?? process.env.VERCEL_PROJECT_ID;
  if (!project) throw new Error('Vercel projectId is not set');

  const body: any = {
    deploymentId,
    project,
  };

  // Same rule as triggerDeploy: omit target for preview.
  if (target === 'production') body.target = 'production';

  const data = await vercelFetchJson<any>(
    '/v13/deployments',
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    ctx,
  );

  return normalizeVercelDeployment(data);
}

export async function findDeploymentByGit(
  params: {
    gitSha?: string;
    target?: VercelTarget;
    branch?: string;
    timeWindowMinutes?: number;
    limit?: number;
  },
  ctx?: VercelContext,
): Promise<NormalizedVercelDeployment | null> {
  const { gitSha, target = 'preview', branch, timeWindowMinutes = 60, limit = 20 } = params;

  const deployments = await getLatestDeployments(target, ctx, limit);

  if (!deployments.length) return null;

  if (gitSha) {
    const exact = deployments.find((d) => {
      const sha = d.meta?.githubCommitSha ?? d.meta?.gitSha;
      return typeof sha === 'string' && sha.toLowerCase() === gitSha.toLowerCase();
    });
    if (exact) return exact;
  }

  if (branch) {
    const now = Date.now();
    const windowMs = timeWindowMinutes * 60 * 1000;
    const candidate = deployments.find((d) => {
      const b = d.meta?.githubCommitRef;
      if (typeof b !== 'string') return false;
      if (b !== branch) return false;
      const createdAt = d.createdAt;
      if (typeof createdAt !== 'number') return false;
      return Math.abs(now - createdAt) <= windowMs;
    });
    if (candidate) return candidate;
  }

  return deployments[0] ?? null;
}
