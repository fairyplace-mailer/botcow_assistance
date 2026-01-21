import { NextResponse } from 'next/server';

import { requireCronSecret } from '@/backend/cronAuth';
import { withCrawlJob } from '@/backend/crawlJobs';
import { ingestWebKb, webKbDailyLockKey } from '@/backend/webKb/webKb';
import { kvGetJson, kvSetJson } from '@/backend/kv';

export async function GET(req: Request) {
  const deny = requireCronSecret(req);
  if (deny) return deny;

  const url = new URL(req.url);
  const force = url.searchParams.get('force') === '1' || url.searchParams.get('force') === 'true';

  const lockKey = webKbDailyLockKey('ingest');
  if (!force) {
    const locked = await kvGetJson<string>(lockKey);
    if (locked) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'locked' });
    }
  }

  const { jobId, result } = await withCrawlJob(
    { kind: 'web-kb-ingest', batchLimit: 15, metaJson: { forced: force } },
    async () => {
      const result = await ingestWebKb({ maxPages: 15, maxDurationMs: 70_000, claimMinutes: 10 });
      return {
        result,
        finish: {
          processed: result.pagesConsidered,
          updated: result.pagesUpdated,
          skipped: result.pagesUnchanged,
          inserted: result.chunksWritten,
          metaJson: { ...result, forced: force },
        },
      };
    },
  );

  await kvSetJson(lockKey, new Date().toISOString());

  return NextResponse.json({ ok: true, forced: force, jobId, ...result });
}
