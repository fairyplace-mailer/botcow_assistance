import { NextResponse } from 'next/server';

import { prisma } from '../../../../backend/db';
import { withCrawlJob } from '../../../../backend/crawlJobs';
import { requireCronSecret } from '../../../../backend/cronAuth';

export const runtime = 'nodejs';

/**
 * Sanity cleanup job for DevWix index.
 *
 * What it does:
 * - deletes DocChunk rows whose DocPage no longer exists (should be rare due to FK cascade)
 * - deletes DocPage rows that are clearly invalid (missing url)
 *
 * Params:
 * - dryRun=true|1
 * - limit (default 500, max 5000)
 */
export async function GET(req: Request) {
  const authResp = requireCronSecret(req);
  if (authResp) return authResp;

  try {
    const { searchParams } = new URL(req.url);
    const dryRun = searchParams.get('dryRun') === '1' || searchParams.get('dryRun') === 'true';
    const limit = Math.max(1, Math.min(5000, Number(searchParams.get('limit') ?? '500')));

    const { jobId, result } = await withCrawlJob(
      {
        kind: 'devwix_sanity_cleanup',
        batchLimit: limit,
        metaJson: { dryRun },
      },
      async () => {
        // Find orphan chunks (page was deleted but chunk remained). Should be impossible with FK,
        // but kept for safety if schema ever drifts.
        const orphanChunkRows: Array<{ id: string }> = await prisma.docChunk.findMany({
          select: { id: true },
          where: { page: null },
          take: limit,
        });
        const orphanChunkIds = orphanChunkRows.map((x: { id: string }) => x.id);

        let deletedOrphanChunks = 0;
        if (!dryRun && orphanChunkIds.length > 0) {
          const res = await prisma.docChunk.deleteMany({
            where: { id: { in: orphanChunkIds } },
          });
          deletedOrphanChunks = res.count;
        }

        // Invalid DocPages (defensive; normally url is required+unique)
        const invalidPageRows: Array<{ id: string }> = await prisma.docPage.findMany({
          select: { id: true },
          where: { url: '' },
          take: limit,
        });
        const invalidPageIds = invalidPageRows.map((x: { id: string }) => x.id);

        let deletedInvalidPages = 0;
        if (!dryRun && invalidPageIds.length > 0) {
          const res = await prisma.docPage.deleteMany({ where: { id: { in: invalidPageIds } } });
          deletedInvalidPages = res.count;
        }

        const deleted = deletedOrphanChunks + deletedInvalidPages;

        return {
          result: {
            dryRun,
            limit,
            orphanChunksFound: orphanChunkIds.length,
            invalidPagesFound: invalidPageIds.length,
            deletedOrphanChunks,
            deletedInvalidPages,
          },
          finish: {
            processed: orphanChunkIds.length + invalidPageIds.length,
            deleted,
          },
        };
      },
    );

    return NextResponse.json({ ok: true, jobId, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
