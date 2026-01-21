import { NextResponse } from 'next/server';

import { requireCronSecret } from '@/backend/cronAuth';
import { withCrawlJob } from '@/backend/crawlJobs';
import { seedWebKb, webKbDailyLockKey } from '@/backend/webKb/webKb';
import { kvGetJson, kvSetJson } from '@/backend/kv';

export async function GET(req: Request) {
  const deny = requireCronSecret(req);
  if (deny) return deny;

  const url = new URL(req.url);
  const force = url.searchParams.get('force') === '1' || url.searchParams.get('force') === 'true';

  const lockKey = webKbDailyLockKey('seed');
  if (!force) {
    const locked = await kvGetJson<string>(lockKey);
    if (locked) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'locked' });
    }
  }

  const { jobId, result } = await withCrawlJob(
    { kind: 'web-kb-seed', batchLimit: 400, metaJson: { forced: force } },
    async () => {
      const result = await seedWebKb({ maxPagesTotal: 400, maxDurationMs: 70_000 });
      return {
        result,
        finish: {
          processed: result.pagesVisited,
          inserted: result.pagesUpserted,
          skipped: 0,
          metaJson: { ...result, forced: force },
        },
      };
    },
  );

  await kvSetJson(lockKey, new Date().toISOString());

  return NextResponse.json({ ok: true, forced: force, jobId, ...result });
}
