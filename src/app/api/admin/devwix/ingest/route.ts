import { NextResponse } from 'next/server';

import { requireAdminBearerAuth } from '../../../../../backend/auth/adminAuth';
import { ingestDevWixArticles } from '../../../../../backend/devWixDocs/ingest';

export async function POST(req: Request) {
  const authError = requireAdminBearerAuth(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const limitPages = Number(searchParams.get('limitPages') ?? '20');

  const result = await ingestDevWixArticles({ limitPages });
  return NextResponse.json({ ok: true, result });
}
