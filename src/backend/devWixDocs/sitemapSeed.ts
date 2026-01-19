import { prisma } from '../db';

const DEFAULT_SITEMAP_URL = 'https://dev.wix.com/docs/sitemap.xml';

function isAllowedDocsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.hostname !== 'dev.wix.com') return false;
    if (!u.pathname.startsWith('/docs/')) return false;

    const denyPrefixes = ['/docs/rest/', '/docs/sdk/', '/docs/api/', '/docs/reference/'];
    if (denyPrefixes.some((p) => u.pathname.startsWith(p))) return false;

    return true;
  } catch {
    return false;
  }
}

function parseSitemapXml(xml: string): string[] {
  // Minimal XML parsing: extract <loc>...</loc>.
  // We avoid adding an XML dependency for now.
  const out: string[] = [];
  const re = /<loc>([^<]+)<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const loc = m[1]?.trim();
    if (loc) out.push(loc);
  }
  return out;
}

export type SeedFromSitemapResult = {
  ok: true;
  sitemapUrl: string;
  found: number;
  allowed: number;
  inserted: number;
  updated: number;
  sample: string[];
};

export async function seedDevWixFromSitemap(opts?: {
  sitemapUrl?: string;
  limitUrls?: number;
}): Promise<SeedFromSitemapResult> {
  const sitemapUrl = opts?.sitemapUrl ?? DEFAULT_SITEMAP_URL;
  const limitUrls = Math.max(1, Math.min(5000, Number(opts?.limitUrls ?? 2000)));

  const res = await fetch(sitemapUrl, {
    headers: {
      'User-Agent': 'botcow_assistance/1.0 (+https://botcow-assistance.vercel.app)',
      Accept: 'application/xml,text/xml,*/*',
    },
  });

  if (!res.ok) {
    // Keep contract simple; caller can treat non-ok as failure.
    throw new Error(`Failed to fetch sitemap: ${res.status} ${res.statusText}`);
  }

  const xml = await res.text();
  const all = parseSitemapXml(xml);
  const found = all.length;

  const allowedUrls: string[] = [];
  for (const u of all) {
    if (!isAllowedDocsUrl(u)) continue;
    allowedUrls.push(u);
    if (allowedUrls.length >= limitUrls) break;
  }

  let inserted = 0;
  let updated = 0;

  const now = new Date();

  // Upsert URLs with empty content; ingest job will fetch+populate.
  for (const url of allowedUrls) {
    const existing = await prisma.docPage.findUnique({ where: { url } });
    if (existing) {
      // do not overwrite fetchedAt/text/contentHash; just mark seen.
      await prisma.docPage.update({ where: { url }, data: { lastSeenAt: now } });
      updated += 1;
    } else {
      await prisma.docPage.create({
        data: {
          url,
          title: null,
          text: '',
          contentHash: 'seed',
          fetchedAt: new Date(0),
          lastSeenAt: now,
        },
      });
      inserted += 1;
    }
  }

  return {
    ok: true,
    sitemapUrl,
    found,
    allowed: allowedUrls.length,
    inserted,
    updated,
    sample: allowedUrls.slice(0, 20),
  };
}
