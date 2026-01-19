import { NextResponse } from 'next/server';

import { ingestDevWixArticles } from '../../../../backend/devWixDocs/ingest';

export const runtime = 'nodejs';

// Vercel Cron calls this endpoint.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    // Per docs/wix_spec.md: update 510 pages per run.
    const limitPages = Math.max(1, Math.min(10, Number(searchParams.get('limitPages') ?? '10')));

    const maxChunksRaw = searchParams.get('maxChunks');
    const maxChunksPerRun = maxChunksRaw ? Number(maxChunksRaw) : undefined;

    const opts: { limitPages?: number; maxChunksPerRun?: number } = { limitPages };
    if (maxChunksPerRun !== undefined && !Number.isNaN(maxChunksPerRun)) {
      opts.maxChunksPerRun = maxChunksPerRun;
    }

    const result = await ingestDevWixArticles(opts);
    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
