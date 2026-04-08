import { prisma } from './db';

export type GithubCacheGetOptions = {
  now?: Date;
};

function hasGithubCacheModel(client: any): boolean {
  return !!client && typeof client === 'object' && !!(client as any).githubCache;
}

export async function githubCacheGet<T>(
  key: string,
  opts: GithubCacheGetOptions = {},
): Promise<T | null> {
  const now = opts.now ?? new Date();

  // In unit tests or environments without DB, prisma model may be absent.
  // Treat cache as a best-effort optimization and fail open.
  if (!hasGithubCacheModel(prisma)) return null;

  try {
    const row = await (prisma as any).githubCache.findUnique({
      where: { key },
      select: { responseJson: true, expiresAt: true },
    });

    if (!row) return null;

    if (row.expiresAt <= now) {
      // Best-effort cleanup
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

  // Best-effort; see note in githubCacheGet.
  if (!hasGithubCacheModel(prisma)) return;

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
