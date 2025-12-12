import { NextResponse } from 'next/server';
import {
  saveDeployment,
  type StoredVercelDeployment,
} from '../../../../backend/vercelDeployStore';
import { verifyVercelWebhookSignature } from '../../../../backend/vercelWebhookAuth';
import {
  commentOnceOnPullRequest,
  findOpenPullRequestByHeadSha,
} from '../../../../backend/githubPr';

export const runtime = 'nodejs';

function pickFirstString(...values: any[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

function inferState(
  eventType: string,
  payload: any,
): StoredVercelDeployment['state'] {
  const t = (eventType || '').toLowerCase();
  if (t === 'deployment.created') return 'created';
  if (t === 'deployment.ready') return 'ready';
  if (t === 'deployment.error') return 'error';

  // fallback to known fields from payload if present
  const s = pickFirstString(
    payload?.deployment?.state,
    payload?.deployment?.readyState,
    payload?.deployment?.status,
  );
  if (!s) return 'unknown';
  const normalized = s.toLowerCase();
  if (['ready', 'completed', 'success'].includes(normalized)) return 'ready';
  if (['error', 'failed'].includes(normalized)) return 'error';
  if (['canceled', 'cancelled'].includes(normalized)) return 'cancelled';
  if (['building', 'queued'].includes(normalized)) return normalized as any;
  return 'unknown';
}

function normalizeUrl(url: string | null): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return `https://${trimmed}`;
}

export async function POST(req: Request) {
  const secret = process.env.VERCEL_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'VERCEL_WEBHOOK_SECRET is not set' },
      { status: 500 },
    );
  }

  const rawBody = await req.text();

  const verified = verifyVercelWebhookSignature({
    rawBody,
    headers: req.headers,
    secret,
  });

  if (!verified.ok) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const body = JSON.parse(rawBody);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const eventType =
    pickFirstString((body as any).type, (body as any).event, (body as any).eventType) ??
    'unknown';
  const deployment =
    (body as any).payload?.deployment ?? (body as any).deployment ?? null;

  const deploymentId = pickFirstString(
    deployment?.id,
    deployment?.uid,
    (body as any).deploymentId,
  );
  if (!deploymentId) {
    return NextResponse.json({ error: 'deploymentId not found' }, { status: 400 });
  }

  const url = normalizeUrl(
    pickFirstString(deployment?.url, deployment?.alias?.[0], deployment?.domains?.[0]),
  );

  const target = pickFirstString(
    deployment?.target,
    deployment?.environment,
    deployment?.env,
  );
  const targetNorm =
    target === 'production' ? 'production' : target === 'preview' ? 'preview' : null;

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
    url,
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

  // PR comment layer: only when we have a SHA and ready preview URL.
  if (stored.state === 'ready' && stored.target === 'preview' && stored.gitSha && stored.url) {
    const pr = await findOpenPullRequestByHeadSha({
      repoFullName,
      sha: stored.gitSha,
    });

    if (pr) {
      const marker = `<!-- botcow:vercel-preview:${stored.deploymentId} -->`;
      const body =
        `${marker}\n` +
        `Vercel preview is ready: ${stored.url}\n\n` +
        `Deployment: ${stored.deploymentId}`;

      await commentOnceOnPullRequest({
        repoFullName,
        pull_number: pr.number,
        body,
        marker,
      });
    }
  }

  return NextResponse.json({ ok: true, verified: verified.algorithm });
}
