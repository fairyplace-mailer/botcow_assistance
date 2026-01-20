import { prisma } from './db';

export type GithubCacheGetOptions = {
  now?: Date;
};

export async function githubCacheGet<T>(key: string, opts: GithubCacheGetOptions = {}): Promise<T | null> {
  const now = opts.now ?? new Date();

  const row = await prisma.githubCache.findUnique({
    where: { key },
    select: { responseJson: true, expiresAt: true },
  });

  if (!row) return null;

  if (row.expiresAt <= now) {
    // Best-effort cleanup
    await prisma.githubCache.delete({ where: { key } }).catch(() => undefined);
    return null;
  }

  return row.responseJson as T;
}

export async function githubCacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number,
  opts: { now?: Date } = {},
): Promise<void> {
  const now = opts.now ?? new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  await prisma.githubCache.upsert({
    where: { key },
    update: { responseJson: value as any, expiresAt },
    create: { key, responseJson: value as any, expiresAt },
  });
}
