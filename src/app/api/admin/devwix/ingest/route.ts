import { NextResponse } from 'next/server';

import { requireAdminBearerAuth } from '../../../../../backend/auth/adminAuth';
import { ingestDevWixArticles } from '../../../../../backend/devWixDocs/ingest';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const authError = requireAdminBearerAuth(req);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const limitPages = Number(searchParams.get('limitPages') ?? '50');
    const maxChunksPerRun = searchParams.get('maxChunks') ? Number(searchParams.get('maxChunks')) : undefined;
    const force = searchParams.get('force') === '1' || searchParams.get('force') === 'true';

    const opts: { limitPages?: number; maxChunksPerRun?: number; force?: boolean } = { limitPages, force };
    if (maxChunksPerRun !== undefined && Number.isFinite(maxChunksPerRun)) {
      opts.maxChunksPerRun = maxChunksPerRun;
    }

    const result = await ingestDevWixArticles(opts);

    return NextResponse.json({ ok: true, jobId: result.jobId, result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
