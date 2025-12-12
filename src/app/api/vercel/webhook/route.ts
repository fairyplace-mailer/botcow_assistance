import { NextResponse } from 'next/server';
import { saveDeployment, type StoredVercelDeployment } from '../../../../backend/vercelDeployStore';

export const runtime = 'nodejs';

function pickFirstString(...values: any[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

function inferState(eventType: string, payload: any): StoredVercelDeployment['state'] {
  const t = (eventType || '').toLowerCase();
  if (t === 'deployment.created') return 'created';
  if (t === 'deployment.ready') return 'ready';
  if (t === 'deployment.error') return 'error';

  // fallback to known fields from payload if present
  const s = pickFirstString(payload?.deployment?.state, payload?.deployment?.readyState, payload?.deployment?.status);
  if (!s) return 'unknown';
  const normalized = s.toLowerCase();
  if (['ready', 'completed', 'success'].includes(normalized)) return 'ready';
  if (['error', 'failed'].includes(normalized)) return 'error';
  if (['canceled', 'cancelled'].includes(normalized)) return 'cancelled';
  if (['building', 'queued'].includes(normalized)) return normalized as any;
  return 'unknown';
}

export async function POST(req: Request) {
  // NOTE: signature verification is intentionally not implemented yet.
  // We store minimal useful state and can tighten security later.

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const eventType = pickFirstString((body as any).type, (body as any).event, (body as any).eventType) ?? 'unknown';
  const deployment = (body as any).payload?.deployment ?? (body as any).deployment ?? null;

  const deploymentId = pickFirstString(deployment?.id, deployment?.uid, (body as any).deploymentId);
  if (!deploymentId) {
    return NextResponse.json({ error: 'deploymentId not found' }, { status: 400 });
  }

  const url = pickFirstString(deployment?.url, deployment?.alias?.[0], deployment?.domains?.[0])
    ? pickFirstString(deployment?.url)
    : null;

  const target = pickFirstString(deployment?.target, deployment?.environment, deployment?.env);
  const targetNorm = target === 'production' ? 'production' : target === 'preview' ? 'preview' : null;

  const gitSha = pickFirstString(
    deployment?.meta?.githubCommitSha,
    deployment?.meta?.gitCommitSha,
    deployment?.meta?.commitSha,
    deployment?.meta?.commit,
    deployment?.gitSource?.sha,
  );

  const gitBranch = pickFirstString(
    deployment?.meta?.githubCommitRef,
    deployment?.meta?.gitBranch,
    deployment?.gitSource?.ref,
  );

  const now = Date.now();

  const stored: StoredVercelDeployment = {
    deploymentId,
    url: url,
    target: targetNorm,
    state: inferState(eventType, { deployment }),
    createdAt: typeof deployment?.createdAt === 'number' ? deployment.createdAt : now,
    updatedAt: now,
    gitSha,
    gitBranch,
    source: 'webhook',
    lastEventType: eventType,
  };

  // IMPORTANT: for now we bind all webhooks to the default repo.
  // If we later support multiple repos/projects, we'll pass repo from webhook config.
  const repoFullName = process.env.BOTCOW_DEFAULT_REPO;
  if (!repoFullName) {
    return NextResponse.json({ error: 'BOTCOW_DEFAULT_REPO is not set' }, { status: 500 });
  }

  await saveDeployment(repoFullName, stored);

  return NextResponse.json({ ok: true });
}
