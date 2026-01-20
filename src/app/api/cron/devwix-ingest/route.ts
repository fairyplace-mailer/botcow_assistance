import { NextResponse } from 'next/server';

import { ingestDevWixArticles } from '../../../../backend/devWixDocs/ingest';
import { withCrawlJob } from '../../../../backend/crawlJobs';

export const runtime = 'nodejs';

// Vercel Cron calls this endpoint.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    // Per docs/wix_spec.md: update 5–10 pages per run.
    const limitPages = Math.max(1, Math.min(10, Number(searchParams.get('limitPages') ?? '10')));

    const maxChunksRaw = searchParams.get('maxChunks');
    const maxChunksPerRun = maxChunksRaw ? Number(maxChunksRaw) : undefined;

    const opts: { limitPages?: number; maxChunksPerRun?: number } = { limitPages };
    if (maxChunksPerRun !== undefined && !Number.isNaN(maxChunksPerRun)) {
      opts.maxChunksPerRun = maxChunksPerRun;
    }

    const { jobId, result } = await withCrawlJob(
      {
        kind: 'devwix_ingest',
        batchLimit: limitPages,
        metaJson: { maxChunksPerRun: opts.maxChunksPerRun ?? null },
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
