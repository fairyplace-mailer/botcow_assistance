import crypto from 'crypto';

import { prisma } from '../db';
import { embedText } from '../openai';

type IngestResult = {
  ok: true;
  startUrl: string;
  limitPages: number;
  fetched: number;
  stored: number;
  skippedUnchanged: number;
  chunksUpserted: number;
  discoveredQueued: number;
  // diagnostics
  startFetched: boolean;
  startStatus: number | null;
  startHtmlBytes: number | null;
  linksFoundTotal: number;
  linksMatchedAllowed: number;
  sampleLinks: string[];
};

function hashText(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function stripHtmlToText(html: string): { title: string | null; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const rawTitle = titleMatch?.[1];
  const title = rawTitle ? rawTitle.replace(/\s+/g, ' ').trim() : null;

  // naive tag stripping
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

  return { title, text };
}

function normalizeUrl(url: string): string | null {
  try {
    const u = new URL(url, 'https://dev.wix.com');
    if (u.origin !== 'https://dev.wix.com') return null;
    u.hash = '';
    // keep query? typically not useful for docs
    u.search = '';
    return u.toString();
  } catch {
    return null;
  }
}

function extractLinksFromAnchors(html: string): string[] {
  const out: string[] = [];
  const re = /<a\s+[^>]*href=("|')([^"']+)("|')[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m?.[2];
    if (!raw) continue;
    const abs = normalizeUrl(raw);
    if (abs) out.push(abs);
  }
  return out;
}

function extractLinksByRegex(html: string): string[] {
  const out: string[] = [];
  // capture absolute or root-relative links inside quotes (covers many Next.js inline data blobs)
  const re = /(?:https?:\/\/dev\.wix\.com)?(\/docs\/[^"]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m?.[1];
    if (!raw) continue;
    const abs = normalizeUrl(raw);
    if (abs) out.push(abs);
  }
  return out;
}

function shouldStorePath(pathname: string): boolean {
  if (!pathname.startsWith('/docs/')) return false;

  // deny big non-article sections to reduce noise/cost
  const denyPrefixes = ['/docs/rest/', '/docs/sdk/', '/docs/api/', '/docs/reference/'];
  if (denyPrefixes.some((p) => pathname.startsWith(p))) return false;

  return true;
}

function chunkText(text: string, maxChars = 1800, overlapChars = 200): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    const end = Math.min(clean.length, i + maxChars);
    const piece = clean.slice(i, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    i = Math.max(0, end - overlapChars);
  }
  return chunks;
}

async function fetchHtmlWithStatus(url: string): Promise<{ status: number; html: string }> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'botcow_assistance/1.0 (+https://botcow-assistance.vercel.app)',
      Accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  });
  const html = await res.text();
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return { status: res.status, html };
}

export async function ingestDevWixArticles(params: {
  limitPages: number;
}): Promise<IngestResult> {
  const startUrl = 'https://dev.wix.com/docs';
  const limitPages = Math.max(1, Math.min(500, params.limitPages));

  const seen = new Set<string>();
  const queue: string[] = [startUrl];

  let fetched = 0;
  let stored = 0;
  let skippedUnchanged = 0;
  let chunksUpserted = 0;

  // diagnostics
  let startFetched = false;
  let startStatus: number | null = null;
  let startHtmlBytes: number | null = null;
  let linksFoundTotal = 0;
  let linksMatchedAllowed = 0;
  const sampleLinks: string[] = [];

  while (queue.length > 0 && fetched < limitPages) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);

    const u = new URL(url);
    if (!shouldStorePath(u.pathname)) {
      continue;
    }

    const { status, html } = await fetchHtmlWithStatus(url);
    fetched += 1;

    if (url === startUrl) {
      startFetched = true;
      startStatus = status;
      startHtmlBytes = Buffer.byteLength(html, 'utf8');
    }

    const { title, text } = stripHtmlToText(html);
    const contentHash = hashText(text);

    const existing = await prisma.docPage.findUnique({ where: { url } });
    if (existing?.contentHash === contentHash) {
      skippedUnchanged += 1;
    } else {
      const saved = await prisma.docPage.upsert({
        where: { url },
        create: {
          url,
          title,
          text,
          contentHash,
          fetchedAt: new Date(),
        },
        update: {
          title,
          text,
          contentHash,
          fetchedAt: new Date(),
        },
      });
      stored += 1;

      // replace chunks for this page
      await prisma.docChunk.deleteMany({ where: { pageId: saved.id } });

      const chunks = chunkText(text).filter((c): c is string => typeof c === 'string' && c.trim().length > 0);

      for (let idx = 0; idx < chunks.length; idx += 1) {
        const content = chunks[idx];
        if (!content) continue;
        const emb = await embedText(content);

        await prisma.docChunk.create({
          data: {
            pageId: saved.id,
            idx,
            content,
            embeddingJson: emb.vector as any,
            embeddingModel: emb.model,
            dims: emb.dims,
          },
        });
        chunksUpserted += 1;
      }
    }

    // discover links
    const discovered = [...extractLinksFromAnchors(html), ...extractLinksByRegex(html)];
    linksFoundTotal += discovered.length;

    for (const link of discovered) {
      if (sampleLinks.length < 5) sampleLinks.push(link);
      if (seen.has(link)) continue;
      const lu = new URL(link);
      if (!shouldStorePath(lu.pathname)) continue;
      linksMatchedAllowed += 1;
      queue.push(link);
    }
  }

  return {
    ok: true,
    startUrl,
    limitPages,
    fetched,
    stored,
    skippedUnchanged,
    chunksUpserted,
    discoveredQueued: queue.length,
    startFetched,
    startStatus,
    startHtmlBytes,
    linksFoundTotal,
    linksMatchedAllowed,
    sampleLinks,
  };
}
