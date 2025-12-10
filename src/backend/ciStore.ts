import fs from 'fs/promises';
import path from 'path';

const STORE_DIR = path.resolve(process.cwd(), '.botcow');
const STORE_FILE = path.join(STORE_DIR, 'ci-runs.json');

export type CiRunRecord = {
  run_id: number;
  workflow_id: string;
  ref: string;
  startedAt: string; // ISO
};

async function ensureStore() {
  try {
    await fs.mkdir(STORE_DIR, { recursive: true });
    try {
      await fs.access(STORE_FILE);
    } catch {
      await fs.writeFile(STORE_FILE, JSON.stringify({}), 'utf8');
    }
  } catch (e) {
    // swallow - best effort
    console.warn('ciStore: could not ensure store', e);
  }
}

export async function saveRun(repo: string, record: CiRunRecord) {
  try {
    await ensureStore();
    const raw = await fs.readFile(STORE_FILE, 'utf8');
    const data = raw ? JSON.parse(raw) : {};
    data[repo] = record;
    await fs.writeFile(STORE_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.warn('ciStore.saveRun error', e);
  }
}

export async function getLastRun(repo: string) {
  try {
    await ensureStore();
    const raw = await fs.readFile(STORE_FILE, 'utf8');
    const data = raw ? JSON.parse(raw) : {};
    return data[repo] as CiRunRecord | undefined;
  } catch (e) {
    console.warn('ciStore.getLastRun error', e);
    return undefined;
  }
}
