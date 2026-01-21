import { prisma } from '../db';

const DEFAULT_SITEMAP_URL = 'https://dev.wix.com/docs/sitemap.xml';

// If Wix ever exposes localized docs under /docs/<lang>/..., ignore those.
const LANG_PREFIX_RE = /^\/docs\/(?!rest\/|sdk\/|api\/|reference\/)([a-z]{2})(?:-[a-z]{2})?\//i;

function isAllowedDocsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.hostname !== 'dev.wix.com') return false;
    if (!u.pathname.startsWith('/docs/')) return false;

    const denyPrefixes = ['/docs/rest/', '/docs/sdk/', '/docs/api/', '/docs/reference/'];
    if (denyPrefixes.some((p) => u.pathname.startsWith(p))) return false;

    // If path looks like /docs/fr/... or /docs/es/... => localized.
    if (LANG_PREFIX_RE.test(u.pathname)) return false;

    return true;
  } catch {
    return false;
  }
}

function parseSitemapLocs(xml: string): string[] {
  // Minimal XML parsing: extract <loc>...</loc>.
  // We avoid adding an XML dependency.
  const out: string[] = [];
  const re = /<loc>([^<]+)<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const loc = m[1]?.trim();
    if (loc) out.push(loc);
  }
  return out;
}

function looksLikeSitemapIndex(xml: string): boolean {
  // sitemapindex contains <sitemap> entries; urlset contains <url> entries.
  return /<sitemapindex[\s>]/i.test(xml) || /<sitemap>[\s\S]*<loc>/i.test(xml);
}

async function fetchXml(url: string): Promise<{ ok: true; url: string; xml: string } | { ok: false; url: string; status: number; statusText: string; bodySample: string }> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'botcow_assistance/1.0 (+https://botcow-assistance.vercel.app)',
      Accept: 'application/xml,text/xml,*/*',
    },
  });

  const body = await res.text();
  if (!res.ok) {
    return {
      ok: false,
      url,
      status: res.status,
      statusText: res.statusText,
      bodySample: body.slice(0, 500),
    };
  }

  return { ok: true, url, xml: body };
}

async function fetchSitemapWithFallbacks(primaryUrl: string): Promise<{ sitemapUrl: string; xml: string }> {
  const candidates = [
    primaryUrl,
    // common alternates
    'https://dev.wix.com/sitemap.xml',
    'https://dev.wix.com/docs/sitemap-index.xml',
    'https://dev.wix.com/sitemap-index.xml',
    'https://dev.wix.com/sitemap_index.xml',
    'https://dev.wix.com/docs/sitemap_index.xml',
  ];

  const errors: string[] = [];
  for (const url of candidates) {
    const r = await fetchXml(url);
    if (r.ok) return { sitemapUrl: r.url, xml: r.xml };
    errors.push(`${url} -> ${r.status} ${r.statusText}`);
  }

  throw new Error(`Failed to fetch sitemap from candidates. Tried: ${errors.join('; ')}`);
}

async function collectUrlsFromSitemapXml(xml: string, limitUrls: number, depthLeft: number): Promise<string[]> {
  const locs = parseSitemapLocs(xml);
  if (!looksLikeSitemapIndex(xml) || depthLeft <= 0) {
    // urlset: locs are page URLs
    return locs.slice(0, limitUrls);
  }

  // sitemapindex: locs are sitemap URLs
  const out: string[] = [];
  for (const sitemapUrl of locs) {
    const r = await fetchXml(sitemapUrl);
    if (!r.ok) continue;
    const childUrls = await collectUrlsFromSitemapXml(r.xml, limitUrls - out.length, depthLeft - 1);
    for (const u of childUrls) {
      out.push(u);
      if (out.length >= limitUrls) return out;
    }
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

  const { sitemapUrl: finalSitemapUrl, xml } = await fetchSitemapWithFallbacks(sitemapUrl);

  // Two-level recursion is enough for most sitemapindex setups.
  const all = await collectUrlsFromSitemapXml(xml, limitUrls, 2);
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
      // Do not overwrite fetchedAt/text/contentHash; just mark seen.
      // IMPORTANT: do not reset nextFetchAt; ingest owns scheduling.
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

          // Make it immediately due for ingest.
          nextFetchAt: now,
          // default refreshIntervalHours applies (24)
        },
      });
      inserted += 1;
    }
  }

  return {
    ok: true,
    sitemapUrl: finalSitemapUrl,
    found,
    allowed: allowedUrls.length,
    inserted,
    updated,
    sample: allowedUrls.slice(0, 20),
  };
}
