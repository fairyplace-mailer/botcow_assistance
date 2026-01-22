import { NextResponse } from 'next/server';

import { seedDevWixByDiscovery } from '../../../../backend/devWixDocs/sitemapSeed';
import { withCrawlJob } from '../../../../backend/crawlJobs';
import { requireCronSecret } from '../../../../backend/cronAuth';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const authResp = requireCronSecret(req);
  if (authResp) return authResp;

  try {
    const { searchParams } = new URL(req.url);

    const startUrl = searchParams.get('startUrl') ?? undefined;

    const maxPagesRaw = searchParams.get('maxPages');
    const maxPages = maxPagesRaw ? Number(maxPagesRaw) : undefined;

    const maxDurationMsRaw = searchParams.get('maxDurationMs');
    const maxDurationMs = maxDurationMsRaw ? Number(maxDurationMsRaw) : undefined;

    const forceRaw = searchParams.get('force');
    const force = forceRaw ? forceRaw === '1' || forceRaw.toLowerCase() === 'true' : undefined;

    const opts: { startUrl?: string; maxPages?: number; maxDurationMs?: number; force?: boolean } = {
      ...(startUrl ? { startUrl } : {}),
      ...(maxPages !== undefined && Number.isFinite(maxPages) ? { maxPages } : {}),
      ...(maxDurationMs !== undefined && Number.isFinite(maxDurationMs) ? { maxDurationMs } : {}),
      ...(force !== undefined ? { force } : {}),
    };

    const batchLimit = Number.isFinite(opts.maxPages) ? (opts.maxPages as number) : null;

    const { jobId, result } = await withCrawlJob(
      {
        kind: 'devwix_seed',
        ...(typeof batchLimit === 'number' ? { batchLimit } : {}),
        metaJson: {
          startUrl: opts.startUrl ?? null,
          maxPages: opts.maxPages ?? null,
          maxDurationMs: opts.maxDurationMs ?? null,
        },
      },
      async () => {
        const result = await seedDevWixByDiscovery(opts);
        return {
          result,
          finish: {
            processed: result.allowed,
            inserted: result.inserted,
            updated: result.updated,
          },
        };
      },
    );

    return NextResponse.json({ ok: true, jobId, result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
