import { NextResponse } from 'next/server';

import { ingestDevWixArticles } from '../../../../backend/devWixDocs/ingest';
import { withCrawlJob } from '../../../../backend/crawlJobs';
import { requireCronSecret } from '../../../../backend/cronAuth';
import { acquireDailyLock, toUtcIsoDate } from '../../../../backend/cronLock';

export const runtime = 'nodejs';

const TASK_NAME = 'devwix-ingest';

// Vercel Cron calls this endpoint.
export async function GET(req: Request) {
  const authResp = requireCronSecret(req);
  if (authResp) return authResp;

  const runStartedAt = new Date();
  const utcDateKey = toUtcIsoDate(runStartedAt);

  try {
    const { searchParams } = new URL(req.url);

    const force = searchParams.get('force') === '1' || searchParams.get('force') === 'true';

    // Per docs/wix_spec.md: update 5–10 pages per run.
    const limitPages = Math.max(1, Math.min(10, Number(searchParams.get('limitPages') ?? '10')));

    const maxChunksRaw = searchParams.get('maxChunks');
    const maxChunksPerRun = maxChunksRaw ? Number(maxChunksRaw) : undefined;

    const opts: { limitPages?: number; maxChunksPerRun?: number; force?: boolean } = { limitPages };
    if (maxChunksPerRun !== undefined && !Number.isNaN(maxChunksPerRun)) {
      opts.maxChunksPerRun = maxChunksPerRun;
    }

    // DB-backed daily lock (like botcat_chat). Prevents duplicates and concurrent runs.
    if (!force) {
      const acquired = await acquireDailyLock({
        name: TASK_NAME,
        utcDateKey,
        now: runStartedAt,
        metaJson: { limitPages, maxChunksPerRun: opts.maxChunksPerRun ?? null },
      });

      if (!acquired) {
        return NextResponse.json({ ok: true, skipped: true, reason: 'locked' });
      }
    } else {
      opts.force = true;
    }

    const { jobId, result } = await withCrawlJob(
      {
        kind: 'devwix_ingest',
        batchLimit: limitPages,
        metaJson: { maxChunksPerRun: opts.maxChunksPerRun ?? null, force },
      },
      async () => {
        const result = await ingestDevWixArticles(opts);
        return {
          result,
          finish: {
            processed: result.fetched,
            updated: result.stored,
            skipped: result.skippedUnchanged,
            metaJson: { stoppedReason: result.stoppedReason ?? null },
          },
        };
      },
    );

    return NextResponse.json({ ok: true, jobId, result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
