import { NextResponse } from 'next/server';

import { prisma } from '../../../../backend/db';
import { deleteMarkdownBlob, listDevWixBlobs } from '../../../../backend/devWixDocs/blob';
import { withCrawlJob } from '../../../../backend/crawlJobs';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limitDeletes = Math.max(1, Math.min(500, Number(searchParams.get('limitDeletes') ?? '100')));
    const dryRun = searchParams.get('dryRun') === '1' || searchParams.get('dryRun') === 'true';

    const { jobId, result } = await withCrawlJob(
      {
        kind: 'devwix_blob_cleanup',
        batchLimit: limitDeletes,
        metaJson: { dryRun },
      },
      async () => {
        const keepRows = await prisma.docPage.findMany({
          select: { blobPath: true },
          where: { blobPath: { not: null } },
        });

        const keep = new Set(
          keepRows
            .map((r: { blobPath: string | null }) => r.blobPath ?? '')
            .filter((x: string) => x.length > 0),
        );

        let cursor: string | undefined;
        let deleted = 0;
        const deletedKeys: string[] = [];

        // Scan blobs in pages; delete up to `limitDeletes` per run.
        while (deleted < limitDeletes) {
          const page = await listDevWixBlobs({ ...(cursor ? { cursor } : {}), limit: 250 });
          cursor = page.cursor;

          for (const key of page.keys) {
            if (deleted >= limitDeletes) break;
            if (keep.has(key)) continue;

            if (!dryRun) {
              await deleteMarkdownBlob(key).catch(() => undefined);
            }

            deleted += 1;
            deletedKeys.push(key);
          }

          if (!cursor) break;
        }

        return {
          result: {
            dryRun,
            limitDeletes,
            deleted,
            deletedKeys,
          },
          finish: {
            processed: deleted + keep.size,
            deleted,
            metaJson: { keepCount: keep.size },
          },
        };
      },
    );

    return NextResponse.json({ ok: true, jobId, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
