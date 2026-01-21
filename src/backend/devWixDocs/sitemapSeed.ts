import { prisma } from '../db';

const DEFAULT_START_URL = 'https://dev.wix.com/docs';

// If Wix ever exposes localized docs under /docs/<lang>/..., ignore those.
const LANG_PREFIX_RE = /^\/docs\/(?!rest\/|sdk\/|api\/|reference\/)([a-z]{2})(?:-[a-z]{2})?\//i;

function canonicalizeDocsUrl(raw: string): string | null {
  try {
    const u = new URL(raw, DEFAULT_START_URL);
    if (u.hostname !== 'dev.wix.com') return null;

    // Remove fragment + query
    u.hash = '';
    u.search = '';

    // Normalize trailing slash (keep /docs itself without trailing slash).
    if (u.pathname.endsWith('/') && u.pathname !== '/docs/') {
      u.pathname = u.pathname.slice(0, -1);
    }

    return u.toString();
  } catch {
    return null;
  }
}

function isAllowedDocsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.hostname !== 'dev.wix.com') return false;
    if (!u.pathname.startsWith('/docs')) return false;

    // Only docs subtree.
    if (!u.pathname.startsWith('/docs')) return false;

    const denyPrefixes = ['/docs/rest/', '/docs/sdk/', '/docs/api/', '/docs/reference/'];
    if (denyPrefixes.some((p) => u.pathname.startsWith(p))) return false;

    // If path looks like /docs/fr/... or /docs/es/... => localized.
    if (LANG_PREFIX_RE.test(u.pathname)) return false;

    // Filter out obvious assets.
    if (u.pathname.match(/\.(png|jpe?g|gif|svg|webp|css|js|map|pdf|zip)$/i)) return false;

    return true;
  } catch {
    return false;
  }
}

function extractLinksFromHtml(html: string, baseUrl: string): string[] {
  const out: string[] = [];

  // Very small HTML link extractor: href="..." or href='...'
  const re = /href\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = (m[1] ?? m[2] ?? '').trim();
    if (!href) continue;
    if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;

    const canon = canonicalizeDocsUrl(new URL(href, baseUrl).toString());
    if (!canon) continue;
    out.push(canon);
  }

  return out;
}

export type SeedByDiscoveryResult = {
  ok: true;
  startUrl: string;
  maxPages: number;
  maxDurationMs: number;
  fetched: number;
  discoveredTotal: number;
  allowed: number;
  inserted: number;
  updated: number;
  sample: string[];
  stoppedReason: 'max_pages' | 'timeout' | 'queue_exhausted' | 'start_fetch_failed';
  startStatus?: number;
};

export async function seedDevWixByDiscovery(opts?: {
  startUrl?: string;
  maxPages?: number;
  maxDurationMs?: number;
  force?: boolean;
}): Promise<SeedByDiscoveryResult> {
  const startUrl = opts?.startUrl ?? DEFAULT_START_URL;
  const maxPages = Math.max(1, Math.min(2000, Number(opts?.maxPages ?? 600)));
  const maxDurationMs = Math.max(5_000, Math.min(10 * 60_000, Number(opts?.maxDurationMs ?? 120_000)));

  const startedAt = Date.now();

  const q: string[] = [];
  const seen = new Set<string>();

  const startCanon = canonicalizeDocsUrl(startUrl);
  if (!startCanon) {
    throw new Error(`Invalid startUrl: ${startUrl}`);
  }

  q.push(startCanon);
  seen.add(startCanon);

  let fetched = 0;
  let discoveredTotal = 0;
  let allowed = 0;

  const allowedUrls: string[] = [];

  // Fetch start page first to ensure we can crawl.
  let startFetchStatus: number | undefined;
  try {
    const res = await fetch(startCanon, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'botcow_assistance/1.0 (+https://botcow-assistance.vercel.app)',
        Accept: 'text/html,*/*',
      },
    });
    startFetchStatus = res.status;
    if (!res.ok) {
      return {
        ok: true,
        startUrl: startCanon,
        maxPages,
        maxDurationMs,
        fetched: 0,
        discoveredTotal: 0,
        allowed: 0,
        inserted: 0,
        updated: 0,
        sample: [],
        stoppedReason: 'start_fetch_failed',
        startStatus: res.status,
      };
    }
    const html = await res.text();
    fetched += 1;

    const links = extractLinksFromHtml(html, startCanon);
    discoveredTotal += links.length;
    for (const u of links) {
      if (!seen.has(u)) {
        seen.add(u);
        q.push(u);
      }
    }
  } catch {
    return {
      ok: true,
      startUrl: startCanon,
      maxPages,
      maxDurationMs,
      fetched: 0,
      discoveredTotal: 0,
      allowed: 0,
      inserted: 0,
      updated: 0,
      sample: [],
      stoppedReason: 'start_fetch_failed',
      startStatus: startFetchStatus,
    };
  }

  // BFS crawl until limits.
  while (q.length > 0) {
    if (Date.now() - startedAt > maxDurationMs) break;
    if (allowedUrls.length >= maxPages) break;

    const url = q.shift() as string;

    if (!isAllowedDocsUrl(url)) continue;

    allowed += 1;
    allowedUrls.push(url);

    // Crawl a bit deeper to discover more URLs.
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'botcow_assistance/1.0 (+https://botcow-assistance.vercel.app)',
          Accept: 'text/html,*/*',
        },
      });
      if (!res.ok) continue;
      const html = await res.text();
      fetched += 1;

      const links = extractLinksFromHtml(html, url);
      discoveredTotal += links.length;
      for (const u of links) {
        if (!seen.has(u)) {
          seen.add(u);
          q.push(u);
        }
      }
    } catch {
      // ignore fetch errors; seed is best-effort
    }
  }

  const stoppedReason: SeedByDiscoveryResult['stoppedReason'] =
    allowedUrls.length >= maxPages ? 'max_pages' : Date.now() - startedAt > maxDurationMs ? 'timeout' : 'queue_exhausted';

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
    startUrl: startCanon,
    maxPages,
    maxDurationMs,
    fetched,
    discoveredTotal,
    allowed: allowedUrls.length,
    inserted,
    updated,
    sample: allowedUrls.slice(0, 20),
    stoppedReason,
    ...(startFetchStatus ? { startStatus: startFetchStatus } : {}),
  };
}
