import { prisma } from './db';

/**
 * Prisma-backed KV store.
 * Replaces Upstash/Vercel KV to avoid Hobby plan KV limits.
 */

type SetOpts = { exSeconds?: number };

function expiresAtFromOpts(opts?: SetOpts): Date | null {
  const ex = opts?.exSeconds;
  if (!ex || ex <= 0) return null;
  return new Date(Date.now() + ex * 1000);
}

export async function kvGetJson<T>(key: string): Promise<T | null> {
  const row = await prisma.kvItem.findUnique({ where: { key } });
  if (!row) return null;

  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    // Best-effort cleanup
    try {
      await prisma.kvItem.delete({ where: { key } });
    } catch {
      // ignore
    }
    return null;
  }

  return row.valueJson as T;
}

export async function kvSetJson(
  key: string,
  value: unknown,
  opts?: SetOpts,
): Promise<void> {
  await prisma.kvItem.upsert({
    where: { key },
    create: {
      key,
      valueJson: value as any,
      expiresAt: expiresAtFromOpts(opts) ?? undefined,
    },
    update: {
      valueJson: value as any,
      expiresAt: expiresAtFromOpts(opts) ?? undefined,
    },
  });
}

export async function kvDel(key: string): Promise<void> {
  try {
    await prisma.kvItem.delete({ where: { key } });
  } catch {
    // ignore if missing
  }
}
