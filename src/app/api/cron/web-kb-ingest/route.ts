import { requireCronSecret } from '@/backend/cronAuth';
import { withCrawlJob } from '@/backend/crawlJobs';
import { ingestWebKb, webKbDailyLockKey } from '@/backend/webKb/webKb';
import { kvGetJson, kvSetJson } from '@/backend/kv';

export async function GET(req: Request) {
  requireCronSecret(req);

  const url = new URL(req.url);
  const force = url.searchParams.get('force') === '1' || url.searchParams.get('force') === 'true';

  // Daily lock (UTC)
  const lockKey = webKbDailyLockKey('web-kb-ingest');
  const existing = await kvGetJson<{ doneAt: string }>(lockKey);
  if (existing && !force) {
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

  await kvSetJson(lockKey, { doneAt: new Date().toISOString() }, 60 * 60 * 36);

  return Response.json({ ok: true, forced: force, ...job.metaJson });
}
