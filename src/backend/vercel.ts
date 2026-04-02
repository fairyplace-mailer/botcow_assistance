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

export type VercelDeploymentListFilters = {
  branch?: string;
  gitSha?: string;
  since?: string;
  until?: string;
  limit?: number;
  target?: VercelTarget;
};

export type NormalizedVercelRuntimeLog = {
  timestamp: string | null;
  level: string | null;
  message: string | null;
  route: string | null;
  functionName: string | null;
  deploymentId: string | null;
  gitSha: string | null;
  branch: string | null;
  requestId: string | null;
  raw: Record<string, unknown> | null;
};

export type VercelRuntimeLogsResult = {
  deploymentId: string;
  logs: NormalizedVercelRuntimeLog[];
  pagination: {
    nextCursor: string | null;
    limit: number;
    hasMore: boolean;
  };
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

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value === 'string' && value) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return null;
}

function normalizeLevel(value: unknown): string | null {
  return typeof value === 'string' && value ? value.toLowerCase() : null;
}

function normalizeMessage(raw: any): string | null {
  if (typeof raw?.message === 'string' && raw.message) return raw.message;
  if (typeof raw?.text === 'string' && raw.text) return raw.text;
  if (typeof raw?.msg === 'string' && raw.msg) return raw.msg;
  if (typeof raw?.line === 'string' && raw.line) return raw.line;
  return null;
}

function normalizeRuntimeLog(raw: any, deploymentId: string): NormalizedVercelRuntimeLog {
  const meta = raw?.meta && typeof raw.meta === 'object' ? raw.meta : {};

  const route =
    (typeof raw?.route === 'string' && raw.route) ||
    (typeof raw?.path === 'string' && raw.path) ||
    (typeof meta?.route === 'string' && meta.route) ||
    null;

  const functionName =
    (typeof raw?.function === 'string' && raw.function) ||
    (typeof raw?.functionName === 'string' && raw.functionName) ||
    (typeof meta?.function === 'string' && meta.function) ||
    (typeof meta?.functionName === 'string' && meta.functionName) ||
    null;

  const gitSha =
    (typeof raw?.gitSha === 'string' && raw.gitSha) ||
    (typeof meta?.githubCommitSha === 'string' && meta.githubCommitSha) ||
    (typeof meta?.gitSha === 'string' && meta.gitSha) ||
    null;

  const branch =
    (typeof raw?.branch === 'string' && raw.branch) ||
    (typeof meta?.githubCommitRef === 'string' && meta.githubCommitRef) ||
    (typeof meta?.gitRef === 'string' && meta.gitRef) ||
    null;

  const requestId =
    (typeof raw?.requestId === 'string' && raw.requestId) ||
    (typeof raw?.request_id === 'string' && raw.request_id) ||
    (typeof meta?.requestId === 'string' && meta.requestId) ||
    null;

  return {
    timestamp: normalizeTimestamp(raw?.timestamp ?? raw?.createdAt ?? raw?.time),
    level: normalizeLevel(raw?.level ?? raw?.severity ?? raw?.type),
    message: normalizeMessage(raw),
    route,
    functionName,
    deploymentId:
      (typeof raw?.deploymentId === 'string' && raw.deploymentId) || deploymentId || null,
    gitSha,
    branch,
    requestId,
    raw: raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null,
  };
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

export async function listDeployments(
  filters: VercelDeploymentListFilters,
  ctx?: VercelContext,
): Promise<NormalizedVercelDeployment[]> {
  const deployments = await getLatestDeployments(filters.target ?? 'preview', ctx, filters.limit ?? 20);

  const sinceMs = filters.since ? Date.parse(filters.since) : null;
  const untilMs = filters.until ? Date.parse(filters.until) : null;

  return deployments.filter((d) => {
    const meta = d.meta ?? {};
    const branch =
      (typeof (meta as any).githubCommitRef === 'string' && (meta as any).githubCommitRef) ||
      (typeof (meta as any).gitRef === 'string' && (meta as any).gitRef) ||
      '';
    const gitSha =
      (typeof (meta as any).githubCommitSha === 'string' && (meta as any).githubCommitSha) ||
      (typeof (meta as any).gitSha === 'string' && (meta as any).gitSha) ||
      '';
    const createdAt = typeof d.createdAt === 'number' ? d.createdAt : null;

    if (filters.branch && branch !== filters.branch) return false;
    if (filters.gitSha && gitSha.toLowerCase() !== filters.gitSha.toLowerCase()) return false;
    if (sinceMs !== null && createdAt !== null && createdAt < sinceMs) return false;
    if (untilMs !== null && createdAt !== null && createdAt > untilMs) return false;
    return true;
  });
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

export async function getRuntimeLogs(
  args: {
    deploymentId: string;
    since?: string;
    until?: string;
    limit?: number;
    cursor?: string;
  },
  ctx?: VercelContext,
): Promise<VercelRuntimeLogsResult> {
  const search = new URLSearchParams();
  if (args.since) search.set('since', args.since);
  if (args.until) search.set('until', args.until);
  if (args.limit) search.set('limit', String(args.limit));
  if (args.cursor) search.set('cursor', args.cursor);

  const qs = search.toString();
  const path = `/v2/deployments/${args.deploymentId}/events${qs ? `?${qs}` : ''}`;
  const data = await vercelFetchJson<any>(path, { method: 'GET' }, ctx);

  const events = Array.isArray(data?.events)
    ? data.events
    : Array.isArray(data?.logs)
      ? data.logs
      : Array.isArray(data)
        ? data
        : [];

  const limit = args.limit ?? events.length;
  const nextCursor =
    (typeof data?.pagination?.next === 'string' && data.pagination.next) ||
    (typeof data?.next === 'string' && data.next) ||
    (typeof data?.nextCursor === 'string' && data.nextCursor) ||
    null;

  return {
    deploymentId: args.deploymentId,
    logs: events.map((item: any) => normalizeRuntimeLog(item, args.deploymentId)),
    pagination: {
      nextCursor,
      limit,
      hasMore: Boolean(nextCursor),
    },
  };
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
