import { prisma } from './db';

function addMinutes(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60 * 1000);
}

export function toUtcIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * DB-backed daily lock, modeled after botcat_chat.
 *
 * Ensures a cron task runs at most once per UTC day (unless forced)
 * and also prevents concurrent executions.
 */
export async function acquireDailyLock(params: {
  name: string;
  utcDateKey: string;
  now: Date;
  lockMinutes?: number;
  metaJson?: unknown;
}): Promise<boolean> {
  const { name, utcDateKey, now } = params;
  const lockMinutes = params.lockMinutes ?? 30;

  const lockedUntil = addMinutes(now, lockMinutes);

  // Ensure row exists.
  await prisma.cronLock.upsert({
    where: { name },
    create: {
      name,
      lockedAt: new Date(0),
      lockedUntil: new Date(0),
      metaJson: null,
    },
    update: {},
  });

  const updated = await prisma.cronLock.updateMany({
    where: {
      name,
      lockedUntil: { lt: now },
      NOT: {
        metaJson: {
          equals: { dateKey: utcDateKey },
        },
      },
    },
    data: {
      lockedAt: now,
      lockedUntil,
      metaJson: { dateKey: utcDateKey, ...(params.metaJson ? { meta: params.metaJson } : {}) },
    },
  });

  return updated.count === 1;
}
