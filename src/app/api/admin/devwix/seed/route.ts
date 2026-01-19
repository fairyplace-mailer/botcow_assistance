import { NextResponse } from 'next/server';

import { requireAdminBearerAuth } from '../../../../../backend/auth/adminAuth';
import { seedDevWixFromSitemap } from '../../../../../backend/devWixDocs/sitemapSeed';

export async function POST(req: Request) {
  const authError = requireAdminBearerAuth(req);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const sitemapUrl = searchParams.get('sitemapUrl') ?? undefined;
    const limitUrlsRaw = searchParams.get('limitUrls');
    const limitUrls = limitUrlsRaw ? Number(limitUrlsRaw) : undefined;

    const result = await seedDevWixFromSitemap({ sitemapUrl, limitUrls });
    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
