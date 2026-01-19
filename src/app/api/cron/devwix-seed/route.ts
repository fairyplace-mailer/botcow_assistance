import { NextResponse } from 'next/server';

import { seedDevWixFromSitemap } from '../../../../backend/devWixDocs/sitemapSeed';

// Optional cron endpoint: seeds URLs from Wix docs sitemap.
// Can be called manually or on a low frequency schedule.
export async function GET(req: Request) {
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
