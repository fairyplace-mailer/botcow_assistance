import { NextResponse } from 'next/server';

import { seedDevWixFromSitemap } from '../../../../backend/devWixDocs/sitemapSeed';
import { withCrawlJob } from '../../../../backend/crawlJobs';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const sitemapUrl = searchParams.get('sitemapUrl') ?? undefined;
    const limitUrlsRaw = searchParams.get('limitUrls');
    const limitUrls = limitUrlsRaw ? Number(limitUrlsRaw) : undefined;

    const opts: { sitemapUrl?: string; limitUrls?: number } = {
      ...(sitemapUrl ? { sitemapUrl } : {}),
      ...(limitUrls !== undefined && Number.isFinite(limitUrls) ? { limitUrls } : {}),
    };

    const batchLimit = Number.isFinite(opts.limitUrls) ? (opts.limitUrls as number) : null;

    const { jobId, result } = await withCrawlJob(
      {
        kind: 'devwix_seed',
        batchLimit: batchLimit ?? undefined,
        metaJson: { sitemapUrl: opts.sitemapUrl ?? null },
      },
      async () => {
        const result = await seedDevWixFromSitemap(opts);
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
