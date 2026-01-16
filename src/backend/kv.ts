import { prisma } from './db';

export type KvSetOptions = {
  ttlSeconds?: number;
};

function expiresAtFromOpts(opts?: KvSetOptions): Date | null {
  if (!opts?.ttlSeconds) return null;
  return new Date(Date.now() + opts.ttlSeconds * 1000);
}

export async function kvGetJson<T = unknown>(key: string): Promise<T | null> {
  const row = await prisma.kvItem.findUnique({ where: { key } });
  if (!row) return null;

  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    // Best-effort cleanup
    await prisma.kvItem.delete({ where: { key } }).catch(() => undefined);
    return null;
  }

  return row.valueJson as T;
}

export async function kvSetJson(key: string, value: unknown, opts?: KvSetOptions): Promise<void> {
  const expiresAt = expiresAtFromOpts(opts);

  await prisma.kvItem.upsert({
    where: { key },
    create: {
      key,
      valueJson: value as any,
      expiresAt,
    },
    update: {
      valueJson: value as any,
      expiresAt,
    },
  });
}

export async function kvDel(key: string): Promise<void> {
  await prisma.kvItem.delete({ where: { key } }).catch(() => undefined);
}
