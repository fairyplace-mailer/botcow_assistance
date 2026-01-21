import { requireCronSecret } from '@/backend/cronAuth';
import { withCrawlJob } from '@/backend/crawlJobs';
import { ingestWebKb } from '@/backend/webKb/webKb';
import { acquireDailyLock, toUtcIsoDate } from '@/backend/cronLock';

export async function GET(req: Request) {
  requireCronSecret(req);

  const url = new URL(req.url);
  const force = url.searchParams.get('force') === '1' || url.searchParams.get('force') === 'true';

  // Daily lock (UTC) — DB-backed, like botcat_chat.
  const now = new Date();
  const utcDateKey = toUtcIsoDate(now);
  const locked = await acquireDailyLock({
    name: 'web-kb-ingest',
    utcDateKey,
    now,
    lockMinutes: 30,
    metaJson: { forced: force },
  });

  if (!locked && !force) {
    return Response.json({ ok: true, skipped: true, reason: 'locked' });
  }

  const job = await withCrawlJob(
    { kind: 'web-kb-ingest', batchLimit: 15, metaJson: { forced: force } },
    async () => {
      const result = await ingestWebKb({ maxPages: 15, maxDurationMs: 70_000, force });
      return {
        result,
        finish: { ok: true, metaJson: { ...result, forced: force } },
      };
    },
  );

  return Response.json({ ok: true, forced: force, jobId: job.jobId, result: job.result });
}
