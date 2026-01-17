import { prisma } from '../db';
import { embedText } from '../openai';
import { kvGetJson, kvSetJson } from '../kv';

type IngestResult = {
  ok: true;
  startUrl: string;
  limitPages: number;
  fetched: number;
  stored: number;
  skippedUnchanged: number;
  chunksUpserted: number;
  discoveredQueued: number;
  stoppedReason?: string;
  // diagnostics
  startFetched: boolean;
  startStatus: number | null;
  startHtmlBytes: number | null;
  startFetchErrorName?: string | null;
  startFetchError?: string | null;
  linksFoundTotal: number;
  linksMatchedAllowed: number;
  sampleLinks: string[];
};

const DEFAULT_START_URL = 'https://dev.wix.com/docs';
const KV_LAST_RUN_KEY = 'devwix:ingest:lastRunAt';

// Allow: any /docs/... page. We use deny-list to avoid huge API reference sections.
function isAllowedPath(pathname: string): boolean {
  if (!pathname.startsWith('/docs/')) return false;

  const denyPrefixes = ['/docs/rest/', '/docs/sdk/', '/docs/api/', '/docs/reference/'];
  if (denyPrefixes.some((p) => pathname.startsWith(p))) return false;

  return true;
}

function normalizeUrl(u: string): string | null {
  try {
    const url = new URL(u, DEFAULT_START_URL);
    if (url.hostname !== 'dev.wix.com') return null;
    url.hash = '';
    // drop query params to reduce duplicates
    url.search = '';
    return url.toString();
  } catch {
    return null;
  }
}

function extractHrefLinks(html: string): string[] {
  const out: string[] = [];
  const re = /<a\s+[^>]*href=["']([^"'#?]+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m?.[1];
    if (!raw) continue;
    const abs = normalizeUrl(raw);
    if (abs) out.push(abs);
  }
  return out;
}

function extractRegexLinks(html: string): string[] {
  const out: string[] = [];
  // Look for any string that contains /docs/... (Next.js may inline route data)
  const re = /"(\/docs\/[^"]{1,300})"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m?.[1];
    if (!raw) continue;
    const abs = normalizeUrl(raw);
    if (abs) out.push(abs);
  }
  return out;
}

function stripHtmlToText(html: string): { title: string | null; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const rawTitle = titleMatch?.[1];
  const title = rawTitle ? rawTitle.replace(/\s+/g, ' ').trim() : null;

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { title, text };
}

function hashText(text: string): string {
  // lightweight deterministic hash
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function chunkText(text: string, maxChars = 1800, overlap = 200): string[] {
  const chunks: string[] = [];
  const t = text.trim();
  if (!t) return chunks;

  let i = 0;
  while (i < t.length) {
    const end = Math.min(t.length, i + maxChars);
    const slice = t.slice(i, end).trim();
    if (slice) chunks.push(slice);
    i = end - overlap;
    if (i < 0) i = 0;
    if (end === t.length) break;
  }
  return chunks;
}

export async function ingestDevWixArticles(
  opts?: {
    limitPages?: number;
    maxChunksPerRun?: number;
    force?: boolean;
  },
): Promise<IngestResult> {
  const limitPages = Math.max(1, Math.min(500, Number(opts?.limitPages ?? 50)));
  const maxChunksPerRun = Math.max(1, Math.min(5000, Number(opts?.maxChunksPerRun ?? 600)));
  const startUrl = DEFAULT_START_URL;

  // Daily gating: cron may call hourly; we only ingest once per ~24h unless forced.
  if (!opts?.force) {
    const lastRunAtIso = await kvGetJson<string>(KV_LAST_RUN_KEY);
    if (lastRunAtIso) {
      const last = new Date(lastRunAtIso).getTime();
      if (!Number.isNaN(last)) {
        const ageMs = Date.now() - last;
        if (ageMs < 23 * 60 * 60 * 1000) {
          return {
            ok: true,
            startUrl,
            limitPages,
            fetched: 0,
            stored: 0,
            skippedUnchanged: 0,
            chunksUpserted: 0,
            discoveredQueued: 0,
            stoppedReason: 'skipped_daily_gate',
            startFetched: false,
            startStatus: null,
            startHtmlBytes: null,
            startFetchErrorName: null,
            startFetchError: null,
            linksFoundTotal: 0,
            linksMatchedAllowed: 0,
            sampleLinks: [],
          };
        }
      }
    }
  }

  const runStartedAt = new Date();

  let fetched = 0;
  let stored = 0;
  let skippedUnchanged = 0;
  let chunksUpserted = 0;

  // diagnostics
  let startFetched = false;
  let startStatus: number | null = null;
  let startHtmlBytes: number | null = null;
  let startFetchErrorName: string | null = null;
  let startFetchError: string | null = null;
  let linksFoundTotal = 0;
  let linksMatchedAllowed = 0;
  let sampleLinks: string[] = [];
  let stoppedReason: string | undefined;

  const queue: string[] = [startUrl];
  const seen = new Set<string>(queue);

  // Fetch start page first to seed queue
  try {
    const res = await fetch(startUrl, {
      headers: {
        'User-Agent': 'botcow_assistance/1.0 (+https://botcow-assistance.vercel.app)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    startFetched = true;
    startStatus = res.status;
    const html = await res.text();
    startHtmlBytes = html.length;

    const hrefLinks = extractHrefLinks(html);
    const rxLinks = extractRegexLinks(html);
    const allLinks = Array.from(new Set([...hrefLinks, ...rxLinks]));

    linksFoundTotal = allLinks.length;
    const allowed = allLinks.filter((u) => {
      try {
        const url = new URL(u);
        return isAllowedPath(url.pathname);
      } catch {
        return false;
      }
    });
    linksMatchedAllowed = allowed.length;
    sampleLinks = allowed.slice(0, 5);

    for (const u of allowed) {
      if (!seen.has(u)) {
        seen.add(u);
        queue.push(u);
      }
    }

    // remove startUrl: it's /docs (not /docs/), not a storable page.
    queue.shift();
  } catch (e: any) {
    startFetchErrorName = e?.name ?? null;
    startFetchError = e?.message ?? String(e);
    return {
      ok: true,
      startUrl,
      limitPages,
      fetched,
      stored,
      skippedUnchanged,
      chunksUpserted,
      discoveredQueued: 0,
      stoppedReason: 'start_fetch_failed',
      startFetched,
      startStatus,
      startHtmlBytes,
      startFetchErrorName,
      startFetchError,
      linksFoundTotal,
      linksMatchedAllowed,
      sampleLinks,
    };
  }

  let discoveredQueued = queue.length;

  // Crawl allowed pages
  while (queue.length > 0 && fetched < limitPages) {
    const url = queue.shift()!;
    const u = new URL(url);

    if (!isAllowedPath(u.pathname)) continue;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'botcow_assistance/1.0 (+https://botcow-assistance.vercel.app)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!res.ok) continue;

    const html = await res.text();
    fetched += 1;

    const { title, text } = stripHtmlToText(html);
    const contentHash = hashText(text);

    const existing = await prisma.docPage.findUnique({ where: { url } });
    if (existing?.contentHash === contentHash) {
      // still mark as seen
      await prisma.docPage.update({ where: { url }, data: { lastSeenAt: runStartedAt } }).catch(() => undefined);
      skippedUnchanged += 1;
      continue;
    }

    const page = await prisma.docPage.upsert({
      where: { url },
      create: {
        url,
        title,
        text,
        contentHash,
        fetchedAt: runStartedAt,
        lastSeenAt: runStartedAt,
      },
      update: {
        title,
        text,
        contentHash,
        fetchedAt: runStartedAt,
        lastSeenAt: runStartedAt,
      },
    });

    stored += 1;

    // recreate chunks for this page
    await prisma.docChunk.deleteMany({ where: { pageId: page.id } });

    const chunks = chunkText(text).filter((c): c is string => typeof c === 'string' && c.trim().length > 0);
    let idx = 0;
    for (const content of chunks) {
      if (chunksUpserted >= maxChunksPerRun) {
        stoppedReason = 'maxChunksPerRun';
        break;
      }
      const emb = await embedText(content);
      await prisma.docChunk.create({
        data: {
          pageId: page.id,
          idx,
          content,
          embeddingJson: emb.vector as any,
          embeddingModel: emb.model,
          dims: emb.dims,
        },
      });
      chunksUpserted += 1;
      idx += 1;
    }

    if (stoppedReason) break;

    // discover more links from this page
    const hrefLinks = extractHrefLinks(html);
    const rxLinks = extractRegexLinks(html);
    const moreLinks = Array.from(new Set([...hrefLinks, ...rxLinks]));

    for (const next of moreLinks) {
      try {
        const nu = new URL(next);
        if (!isAllowedPath(nu.pathname)) continue;
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      } catch {
        // ignore
      }
    }

    discoveredQueued = queue.length;
  }

  // Cleanup: remove pages not seen during this run (and their chunks via cascade)
  await prisma.docPage.deleteMany({
    where: {
      lastSeenAt: { lt: runStartedAt },
    },
  });

  // record last run
  await kvSetJson(KV_LAST_RUN_KEY, new Date().toISOString());

  return {
    ok: true,
    startUrl,
    limitPages,
    fetched,
    stored,
    skippedUnchanged,
    chunksUpserted,
    discoveredQueued,
    stoppedReason,
    startFetched,
    startStatus,
    startHtmlBytes,
    startFetchErrorName,
    startFetchError,
    linksFoundTotal,
    linksMatchedAllowed,
    sampleLinks,
  };
}
