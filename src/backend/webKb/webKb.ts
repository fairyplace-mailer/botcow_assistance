import { prisma } from '../db';
import { embedText } from '../openai';
import { WEB_KB_SOURCES, type WebKbSource } from './sources';

export type WebKbSeedResult = {
  sourcesTotal: number;
  sourcesCompleted: number;
  pagesVisited: number;
  pagesUpserted: number;
  pagesFetchFailed: number;
  stoppedByTimeout: boolean;
};

export type WebKbIngestResult = {
  pagesConsidered: number;
  pagesFetched: number;
  pagesUnchanged: number;
  pagesUpdated: number;
  pagesFailed: number;
  chunksWritten: number;
  stoppedByTimeout: boolean;
};

function nowIsoDateKeyUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (!u.hostname) return null;
    u.hash = '';

    // Drop common trackers.
    const dropParams = new Set([
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'gclid',
      'fbclid',
    ]);
    for (const k of Array.from(u.searchParams.keys())) {
      if (dropParams.has(k)) u.searchParams.delete(k);
    }
    // Sort params for canonical form.
    const sorted = Array.from(u.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b));
    u.search = '';
    for (const [k, v] of sorted) u.searchParams.append(k, v);

    return u.toString();
  } catch {
    return null;
  }
}

function isSameDomain(url: string, domain: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === domain || u.hostname === `www.${domain}`;
  } catch {
    return false;
  }
}

function isAllowedByRules(url: string, source: WebKbSource): boolean {
  try {
    const u = new URL(url);
    if (!isSameDomain(url, source.domain)) return false;

    const path = u.pathname || '/';
    if (!source.allowedPathPrefixes.some((p) => path.startsWith(p))) return false;

    const lower = path.toLowerCase();
    if (source.denyPathSubstrings.some((d) => lower.includes(d))) return false;

    return true;
  } catch {
    return false;
  }
}

function classifyRefreshIntervalHours(url: string): number {
  const u = url.toLowerCase();

  // 24h "important" pages.
  if (
    u.includes('shipping') ||
    u.includes('delivery') ||
    u.includes('returns') ||
    u.includes('refund') ||
    u.includes('privacy') ||
    u.includes('terms') ||
    u.includes('policy') ||
    u.includes('coupon') ||
    u.includes('discount') ||
    u.includes('wholesale') ||
    u.includes('bulk') ||
    u.includes('pricing') ||
    u.includes('price')
  ) {
    return 24;
  }

  // Default static cadence: 20 days.
  return 24 * 20;
}

function extractLinks(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const re = /href\s*=\s*"([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1];
    if (!href) continue;
    try {
      const abs = new URL(href, baseUrl).toString();
      out.push(abs);
    } catch {
      continue;
    }
  }
  return out;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashText(text: string): string {
  // Simple stable hash (non-crypto): ok for change detection.
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv1a:${(h >>> 0).toString(16)}`;
}

function vectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

function chunkByChars(text: string, opts: { chunkSize: number; overlap: number }): string[] {
  const t = text.trim();
  if (!t) return [];
  const out: string[] = [];
  let i = 0;
  while (i < t.length) {
    const end = Math.min(t.length, i + opts.chunkSize);
    out.push(t.slice(i, end));
    if (end === t.length) break;
    i = Math.max(0, end - opts.overlap);
  }
  return out;
}

async function ensureSite(domain: string) {
  return prisma.webSite.upsert({
    where: { domain },
    create: { domain },
    update: {},
  });
}

export async function seedWebKb(opts?: {
  maxPagesTotal?: number;
  maxDurationMs?: number;
}): Promise<WebKbSeedResult> {
  const maxPagesTotal = Math.max(50, Math.min(800, Number(opts?.maxPagesTotal ?? 400)));
  const maxDurationMs = Math.max(10_000, Math.min(120_000, Number(opts?.maxDurationMs ?? 70_000)));

  const startedAt = Date.now();
  let pagesVisited = 0;
  let pagesUpserted = 0;
  let pagesFetchFailed = 0;

  for (const source of WEB_KB_SOURCES) {
    await ensureSite(source.domain);
  }

  const sourcesTotal = WEB_KB_SOURCES.length;
  let sourcesCompleted = 0;

  for (const source of WEB_KB_SOURCES) {
    if (Date.now() - startedAt > maxDurationMs) break;

    const site = await prisma.webSite.findUnique({ where: { domain: source.domain } });
    if (!site) continue;

    const queue: string[] = [...source.startUrls];
    const seen = new Set<string>();

    while (queue.length) {
      if (pagesVisited >= maxPagesTotal) break;
      if (Date.now() - startedAt > maxDurationMs) break;

      const raw = queue.shift()!;
      const normalized = normalizeUrl(raw);
      if (!normalized) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      if (!isAllowedByRules(normalized, source)) continue;

      pagesVisited += 1;

      try {
        const res = await fetch(normalized, {
          headers: {
            'User-Agent': 'botcow_assistance/1.0 (+https://botcow-assistance.vercel.app)',
            Accept: 'text/html,application/xhtml+xml',
          },
        });

        const html = await res.text();

        // Upsert page record (seed only)
        await prisma.webPage.upsert({
          where: { url: normalized },
          create: {
            siteId: site.id,
            url: normalized,
            title: null,
            httpStatus: res.status,
            excludedReason: null,
            lastSeenAt: new Date(),
            refreshIntervalHours: classifyRefreshIntervalHours(normalized),
            nextFetchAt: new Date(),
          },
          update: {
            httpStatus: res.status,
            excludedReason: null,
            lastSeenAt: new Date(),
            refreshIntervalHours: classifyRefreshIntervalHours(normalized),
          },
        });
        pagesUpserted += 1;

        // Discover links for same-domain crawl
        for (const link of extractLinks(html, normalized)) {
          const n = normalizeUrl(link);
          if (!n) continue;
          if (seen.has(n)) continue;
          if (!isAllowedByRules(n, source)) continue;
          queue.push(n);
        }
      } catch {
        pagesFetchFailed += 1;
        continue;
      }
    }

    sourcesCompleted += 1;
  }

  return {
    sourcesTotal,
    sourcesCompleted,
    pagesVisited,
    pagesUpserted,
    pagesFetchFailed,
    stoppedByTimeout: Date.now() - startedAt > maxDurationMs,
  };
}

export async function ingestWebKb(opts?: {
  maxPages?: number;
  maxDurationMs?: number;
  claimMinutes?: number;
}): Promise<WebKbIngestResult> {
  const maxPages = Math.max(1, Math.min(30, Number(opts?.maxPages ?? 15)));
  const maxDurationMs = Math.max(10_000, Math.min(120_000, Number(opts?.maxDurationMs ?? 70_000)));
  const claimMinutes = Math.max(1, Math.min(60, Number(opts?.claimMinutes ?? 10)));

  const startedAt = Date.now();

  let pagesConsidered = 0;
  let pagesFetched = 0;
  let pagesUnchanged = 0;
  let pagesUpdated = 0;
  let pagesFailed = 0;
  let chunksWritten = 0;

  // Claim due pages to avoid double-processing.
  const claimed = await prisma.$transaction(async (tx) => {
    const due = await tx.webPage.findMany({
      where: {
        excludedReason: null,
        OR: [{ nextFetchAt: null }, { nextFetchAt: { lte: new Date() } }],
      },
      orderBy: [{ nextFetchAt: 'asc' }, { fetchedAt: 'asc' }],
      take: maxPages,
    });

    const ids = due.map((p) => p.id);
    if (ids.length) {
      await tx.webPage.updateMany({
        where: { id: { in: ids } },
        data: { nextFetchAt: new Date(Date.now() + claimMinutes * 60 * 1000) },
      });
    }

    return due;
  });

  for (const p of claimed) {
    if (Date.now() - startedAt > maxDurationMs) break;

    pagesConsidered += 1;

    try {
      const res = await fetch(p.url, {
        headers: {
          'User-Agent': 'botcow_assistance/1.0 (+https://botcow-assistance.vercel.app)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });

      if (!res.ok) {
        await prisma.webPage.update({
          where: { id: p.id },
          data: {
            httpStatus: res.status,
            nextFetchAt: new Date(Date.now() + 30 * 60 * 1000),
          },
        });
        pagesFailed += 1;
        continue;
      }

      const html = await res.text();
      pagesFetched += 1;

      const text = stripHtml(html);
      const contentHash = hashText(text);

      if (p.contentHash && p.contentHash === contentHash) {
        await prisma.webPage.update({
          where: { id: p.id },
          data: {
            fetchedAt: new Date(),
            lastSeenAt: new Date(),
            httpStatus: res.status,
            nextFetchAt: new Date(Date.now() + p.refreshIntervalHours * 60 * 60 * 1000),
          },
        });
        pagesUnchanged += 1;
        continue;
      }

      // Update page record
      const page = await prisma.webPage.update({
        where: { id: p.id },
        data: {
          fetchedAt: new Date(),
          lastSeenAt: new Date(),
          httpStatus: res.status,
          contentHash,
          nextFetchAt: new Date(Date.now() + p.refreshIntervalHours * 60 * 60 * 1000),
        },
      });

      // Recreate chunks
      await prisma.webChunk.deleteMany({ where: { pageId: page.id } });

      const chunks = chunkByChars(text, { chunkSize: 2200, overlap: 250 });
      let idx = 0;
      for (const c of chunks) {
        if (Date.now() - startedAt > maxDurationMs) break;

        const content = c.trim();
        if (!content) continue;

        const emb = await embedText(content);

        const created = await prisma.webChunk.create({
          data: {
            pageId: page.id,
            idx,
            content,
            embeddingModel: emb.model,
            dims: emb.dims,
          },
        });

        await prisma.$executeRawUnsafe(
          `UPDATE \"WebChunk\" SET \"embedding\" = '${vectorLiteral(emb.vector)}'::vector WHERE id = '${created.id}'`,
        );

        chunksWritten += 1;
        idx += 1;
      }

      pagesUpdated += 1;
    } catch {
      await prisma.webPage
        .update({
          where: { id: p.id },
          data: {
            nextFetchAt: new Date(Date.now() + 30 * 60 * 1000),
          },
        })
        .catch(() => undefined);
      pagesFailed += 1;
      continue;
    }
  }

  return {
    pagesConsidered,
    pagesFetched,
    pagesUnchanged,
    pagesUpdated,
    pagesFailed,
    chunksWritten,
    stoppedByTimeout: Date.now() - startedAt > maxDurationMs,
  };
}

export function webKbDailyLockKey(kind: 'seed' | 'ingest'): string {
  return `webkb:${kind}:${nowIsoDateKeyUTC()}`;
}
