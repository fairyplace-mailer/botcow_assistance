import { prisma } from './db';

export type GithubCacheGetOptions = {
  now?: Date;
};

function isGithubCacheUsable(client: any): boolean {
  if (!client || typeof client !== 'object') return false;

  if (process.env.NODE_ENV === 'test') return false;
  if (process.env.BOTCOW_DISABLE_GITHUB_CACHE === '1') return false;

  const delegate = (client as any).githubCache;
  return (
    !!delegate &&
    typeof delegate.findUnique === 'function' &&
    typeof delegate.upsert === 'function' &&
    typeof delegate.delete === 'function'
  );
}

export async function githubCacheGet<T>(
  key: string,
  opts: GithubCacheGetOptions = {},
): Promise<T | null> {
  const now = opts.now ?? new Date();

  // Cache is best-effort only.
  // In tests and DB-less environments it must stay completely disabled.
  if (!isGithubCacheUsable(prisma)) return null;

  try {
    const row = await (prisma as any).githubCache.findUnique({
      where: { key },
      select: { responseJson: true, expiresAt: true },
    });

    if (!row) return null;

    if (row.expiresAt <= now) {
      await (prisma as any).githubCache.delete({ where: { key } }).catch(() => undefined);
      return null;
    }

    return row.responseJson as T;
  } catch {
    return null;
  }
}

export async function githubCacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number,
  opts: { now?: Date } = {},
): Promise<void> {
  const now = opts.now ?? new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  // Cache is best-effort only.
  // In tests and DB-less environments it must stay completely disabled.
  if (!isGithubCacheUsable(prisma)) return;

  try {
    await (prisma as any).githubCache.upsert({
      where: { key },
      update: { responseJson: value as any, expiresAt },
      create: { key, responseJson: value as any, expiresAt },
    });
  } catch {
    // fail-open: cache write must not break GitHub flow
  }
}
