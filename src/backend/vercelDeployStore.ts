import { getBlobJson, putBlob } from './blob-util';

export type VercelDeploymentState =
  | 'created'
  | 'ready'
  | 'error'
  | 'canceled'
  | 'cancelled'
  | 'building'
  | 'queued'
  | 'unknown';

export type VercelWebhookEventType =
  | 'deployment.created'
  | 'deployment.ready'
  | 'deployment.error'
  | string;

export interface StoredVercelDeployment {
  deploymentId: string;
  url: string | null;
  target: 'preview' | 'production' | null;
  state: VercelDeploymentState;
  createdAt: number;
  updatedAt: number;
  // git linkage
  gitSha: string | null;
  gitBranch: string | null;
  // raw (optional)
  source: 'webhook' | 'api';
  lastEventType: VercelWebhookEventType | null;
}

export interface DeploymentIndexEntry {
  deploymentId: string;
  url: string | null;
  state: VercelDeploymentState;
  updatedAt: number;
  target: 'preview' | 'production' | null;
  gitSha: string | null;
}

function sanitizeKeyPart(v: string) {
  return v.replace(/[^a-zA-Z0-9._\-\/]/g, '_');
}

function repoKey(repoFullName: string) {
  return sanitizeKeyPart(repoFullName);
}

export function blobPathForDeployment(repoFullName: string, deploymentId: string) {
  return `vercel/deployments/${repoKey(repoFullName)}/${deploymentId}.json`;
}

export function blobPathForShaIndex(repoFullName: string, gitSha: string) {
  return `vercel/index/by-sha/${repoKey(repoFullName)}/${gitSha}.json`;
}

export function blobPathForBranchIndex(repoFullName: string, branch: string) {
  return `vercel/index/by-branch/${repoKey(repoFullName)}/${sanitizeKeyPart(branch)}.json`;
}

async function upsertIndex(
  path: string,
  entry: DeploymentIndexEntry,
  limit: number,
): Promise<void> {
  const current = (await getBlobJson<DeploymentIndexEntry[]>(path)) ?? [];
  const filtered = current.filter((e) => e.deploymentId !== entry.deploymentId);
  const next = [entry, ...filtered]
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, limit);

  await putBlob(path, JSON.stringify(next, null, 2));
}

export async function saveDeployment(
  repoFullName: string,
  deployment: StoredVercelDeployment,
) {
  const depPath = blobPathForDeployment(repoFullName, deployment.deploymentId);
  await putBlob(depPath, JSON.stringify(deployment, null, 2));

  const indexEntry: DeploymentIndexEntry = {
    deploymentId: deployment.deploymentId,
    url: deployment.url,
    state: deployment.state,
    updatedAt: deployment.updatedAt,
    target: deployment.target,
    gitSha: deployment.gitSha,
  };

  if (deployment.gitSha) {
    await upsertIndex(
      blobPathForShaIndex(repoFullName, deployment.gitSha),
      indexEntry,
      10,
    );
  }

  if (deployment.gitBranch) {
    await upsertIndex(
      blobPathForBranchIndex(repoFullName, deployment.gitBranch),
      indexEntry,
      10,
    );
  }
}

export async function getLatestForSha(repoFullName: string, gitSha: string) {
  const list = await getBlobJson<DeploymentIndexEntry[]>(
    blobPathForShaIndex(repoFullName, gitSha),
  );
  return (list && list[0]) || null;
}

export async function getLatestForBranch(repoFullName: string, branch: string) {
  const list = await getBlobJson<DeploymentIndexEntry[]>(
    blobPathForBranchIndex(repoFullName, branch),
  );
  return (list && list[0]) || null;
}
