import { NextResponse } from 'next/server';

import { requireAdminBearerAuth } from '../../../../../backend/auth/adminAuth';
import { ingestDevWixDocsArticles } from '../../../../../backend/devWixDocs/ingest';

export async function POST(req: Request) {
  const authError = requireAdminBearerAuth(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const limitPages = Number(searchParams.get('limitPages') ?? '20');

  const result = await ingestDevWixDocsArticles({ limitPages });
  return NextResponse.json({ ok: true, result });
}
