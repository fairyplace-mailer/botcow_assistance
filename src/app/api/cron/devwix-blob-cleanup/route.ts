import { NextResponse } from 'next/server';

import { prisma } from '@/backend/db';
import { listDevWixBlobs, deleteMarkdownBlob } from '@/backend/devWixDocs/blob';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const limitDeletesRaw = searchParams.get('limitDeletes');
    const dryRunRaw = searchParams.get('dryRun');

    const limitDeletes = limitDeletesRaw ? Number(limitDeletesRaw) : 100;
    const dryRun = dryRunRaw === '1' || dryRunRaw === 'true';

    const limit = Math.min(Math.max(limitDeletes, 1), 500);

    const keepRows = await prisma.docPage.findMany({
      where: {
        blobPath: {
          not: null,
        },
      },
      select: {
        blobPath: true,
      },
    });

    const keep = new Set(
      keepRows
        .map((r) => r.blobPath)
        .filter((x): x is string => typeof x === 'string' && x.length > 0),
    );

    let cursor: string | undefined;
    let deleted = 0;
    let scanned = 0;
    const orphanKeys: string[] = [];

    // Scan blobs in pages; delete up to `limit` per run.
    while (deleted < limit) {
      const page = await listDevWixBlobs({ cursor, limit: 250 });
      cursor = page.cursor;

      for (const key of page.keys) {
        scanned += 1;
        if (keep.has(key)) continue;

        orphanKeys.push(key);
        if (!dryRun) {
          await deleteMarkdownBlob(key);
        }
        deleted += 1;
        if (deleted >= limit) break;
      }

      if (!page.hasMore) break;
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      scanned,
      deleted,
      orphanKeys,
      keepCount: keep.size,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 },
    );
  }
}
