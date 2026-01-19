import { NextResponse } from 'next/server';

import { requireAdminBearerAuth } from '../../../../../backend/auth/adminAuth';
import { seedDevWixFromSitemap } from '../../../../../backend/devWixDocs/sitemapSeed';

export async function POST(req: Request) {
  const authError = requireAdminBearerAuth(req);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);

    const sitemapUrlParam = searchParams.get('sitemapUrl');
    const sitemapUrl = sitemapUrlParam ?? undefined;

    const limitUrlsRaw = searchParams.get('limitUrls');
    const limitUrls = limitUrlsRaw ? Number(limitUrlsRaw) : undefined;

    const opts = {
      ...(sitemapUrl ? { sitemapUrl } : {}),
      ...(typeof limitUrls === 'number' && Number.isFinite(limitUrls) ? { limitUrls } : {}),
    };

    const result = await seedDevWixFromSitemap(opts);
    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
