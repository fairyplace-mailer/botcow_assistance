import { NextResponse } from 'next/server';

import { ingestDevWixArticles } from '../../../../backend/devWixDocs/ingest';

// Vercel Cron calls this endpoint. We rely on "daily gate" in ingestDevWixArticles
// so calling hourly is cheap and safe.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limitPages = Number(searchParams.get('limitPages') ?? '200');
    const maxChunksPerRun = searchParams.get('maxChunks') ? Number(searchParams.get('maxChunks')) : 600;

    const result = await ingestDevWixArticles({ limitPages, maxChunksPerRun });
    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
