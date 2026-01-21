import { NextResponse } from 'next/server';

import { requireAdminBearerAuth } from '../../../../../backend/auth/adminAuth';
import { seedDevWixByDiscovery } from '../../../../../backend/devWixDocs/sitemapSeed';
import { withCrawlJob } from '../../../../../backend/crawlJobs';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const authError = requireAdminBearerAuth(req);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);

    const startUrl = searchParams.get('startUrl') ?? undefined;
    const maxPagesRaw = searchParams.get('maxPages');
    const maxPages = maxPagesRaw ? Number(maxPagesRaw) : undefined;

    const maxDurationMsRaw = searchParams.get('maxDurationMs');
    const maxDurationMs = maxDurationMsRaw ? Number(maxDurationMsRaw) : undefined;

    const opts: { startUrl?: string; maxPages?: number; maxDurationMs?: number } = {
      ...(startUrl ? { startUrl } : {}),
      ...(maxPages !== undefined && Number.isFinite(maxPages) ? { maxPages } : {}),
      ...(maxDurationMs !== undefined && Number.isFinite(maxDurationMs) ? { maxDurationMs } : {}),
    };

    const batchLimit = Number.isFinite(opts.maxPages) ? (opts.maxPages as number) : null;

    const { jobId, result } = await withCrawlJob(
      {
        kind: 'devwix_seed_admin',
        ...(typeof batchLimit === 'number' ? { batchLimit } : {}),
        metaJson: {
          startUrl: opts.startUrl ?? null,
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
