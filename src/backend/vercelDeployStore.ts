import { kvGetJson, kvSetJson } from './kv';

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

const LATEST_TTL_SECONDS = 20 * 24 * 60 * 60; // 20 days

function sanitizeKeyPart(v: string) {
  return v.replace(/[^a-zA-Z0-9._\-/]/g, '_');
}

function repoKey(repoFullName: string) {
  return sanitizeKeyPart(repoFullName);
}

function kvKeyForDeployment(repoFullName: string, deploymentId: string) {
  return `vercel:deployment:${repoKey(repoFullName)}:${deploymentId}`;
}

function kvKeyForLatestBySha(repoFullName: string, gitSha: string) {
  return `vercel:latestBySha:${repoKey(repoFullName)}:${gitSha}`;
}

function kvKeyForLatestByBranch(repoFullName: string, branch: string) {
  return `vercel:latestByBranch:${repoKey(repoFullName)}:${sanitizeKeyPart(branch)}`;
}

export async function saveDeployment(
  repoFullName: string,
  deployment: StoredVercelDeployment,
) {
  // Store the full deployment record (no TTL by default)
  await kvSetJson(
    kvKeyForDeployment(repoFullName, deployment.deploymentId),
    deployment,
  );

  const indexEntry: DeploymentIndexEntry = {
    deploymentId: deployment.deploymentId,
    url: deployment.url,
    state: deployment.state,
    updatedAt: deployment.updatedAt,
    target: deployment.target,
    gitSha: deployment.gitSha,
  };

  if (deployment.gitSha) {
    await kvSetJson(kvKeyForLatestBySha(repoFullName, deployment.gitSha), indexEntry, {
      exSeconds: LATEST_TTL_SECONDS,
    });
  }

  if (deployment.gitBranch) {
    await kvSetJson(
      kvKeyForLatestByBranch(repoFullName, deployment.gitBranch),
      indexEntry,
      { exSeconds: LATEST_TTL_SECONDS },
    );
  }
}

export async function getLatestForSha(repoFullName: string, gitSha: string) {
  const entry = await kvGetJson<DeploymentIndexEntry>(
    kvKeyForLatestBySha(repoFullName, gitSha),
  );
  return entry ?? null;
}

export async function getLatestForBranch(repoFullName: string, branch: string) {
  const entry = await kvGetJson<DeploymentIndexEntry>(
    kvKeyForLatestByBranch(repoFullName, branch),
  );
  return entry ?? null;
}
