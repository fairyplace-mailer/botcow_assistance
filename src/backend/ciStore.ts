import { kvGetJson, kvSetJson } from './kv';

export type CiRunRecord = {
  run_id: number | null; // null if not yet resolved
  workflow_id: string;
  ref: string;
  startedAt: string; // ISO
  status?: 'pending' | 'found' | 'not_found';
};

function keyForRepo(repo: string) {
  return `ci:lastRun:${repo}`;
}

const CI_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export async function saveRun(repo: string, record: CiRunRecord) {
  await kvSetJson(keyForRepo(repo), record, { ttlSeconds: CI_TTL_SECONDS });
}

export async function getLastRun(repo: string) {
  const rawRecord = await kvGetJson<any>(keyForRepo(repo));
  if (!rawRecord) return undefined;

  const migrated: CiRunRecord = {
    run_id: rawRecord.run_id === -1 ? null : rawRecord.run_id ?? null,
    workflow_id: rawRecord.workflow_id,
    ref: rawRecord.ref,
    startedAt: rawRecord.startedAt,
    status: rawRecord.status ?? (rawRecord.run_id === -1 ? 'pending' : undefined),
  };

  return migrated as CiRunRecord | undefined;
}
