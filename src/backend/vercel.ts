const VERCEL_API_BASE = 'https://api.vercel.com';

const token = process.env.VERCEL_TOKEN;
const projectId = process.env.VERCEL_PROJECT_ID;
const teamId = process.env.VERCEL_TEAM_ID;

export type VercelTarget = 'production' | 'preview';

if (!token) {
  throw new Error('VERCEL_TOKEN is not set');
}

function buildHeaders() {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function withTeam(url: URL) {
  if (teamId) {
    url.searchParams.set('teamId', teamId);
  }
}

export async function getLatestDeployments(
  env: VercelTarget | 'all' = 'production',
) {

  const url = new URL('/v6/deployments', VERCEL_API_BASE);

  if (projectId) {
    url.searchParams.set('projectId', projectId);
  }

  withTeam(url);
  url.searchParams.set('limit', '5');

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

export async function getDeploymentStatus(deploymentId: string) {
  const url = new URL(`/v13/deployments/${deploymentId}`, VERCEL_API_BASE);
  withTeam(url);

  const res = await fetch(url, { headers: buildHeaders() });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vercel getDeploymentStatus failed: ${res.status} ${text}`);
  }

  return res.json();
}

export async function triggerDeploy(projectIdOverride?: string, gitSha?: string) {
  const pid = projectIdOverride ?? projectId;

  if (!pid) {
    throw new Error('VERCEL_PROJECT_ID is not set');
  }

  const url = new URL('/v13/deployments', VERCEL_API_BASE);
  withTeam(url);

  const body: any = {
    name: pid,
    project: pid,
    target: 'production',
  };

  if (gitSha) {
    body.gitSource = {
      type: 'github',
      ref: 'main',
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

export async function redeploy(deploymentId: string) {
  if (!projectId) {
    throw new Error('VERCEL_PROJECT_ID is not set');
  }

  const url = new URL('/v13/deployments', VERCEL_API_BASE);
  withTeam(url);

  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({
      name: projectId,
      project: projectId,
      target: 'production',
      deploymentId,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vercel redeploy failed: ${res.status} ${text}`);
  }

  return res.json();
}
