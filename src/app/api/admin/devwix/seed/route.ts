import { NextResponse } from 'next/server';

import { requireAdminBearerAuth } from '../../../../../backend/auth/adminAuth';
import { bootstrapDevWixKnowledge } from '../../../../../backend/devWixDocs/bootstrap';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const authError = requireAdminBearerAuth(req);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);

    const batchLimitRaw = searchParams.get('batchLimit');
    const batchLimit = batchLimitRaw ? Number(batchLimitRaw) : undefined;

    const cursorRaw = searchParams.get('cursor');
    const cursor = cursorRaw ? Number(cursorRaw) : undefined;

    const result = await bootstrapDevWixKnowledge({
      ...(Number.isFinite(batchLimit) ? { batchLimit } : {}),
      ...(Number.isFinite(cursor) ? { cursor } : {}),
    });

    return NextResponse.json({ ok: true, jobId: result.jobId, result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
