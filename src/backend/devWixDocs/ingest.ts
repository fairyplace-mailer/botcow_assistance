import crypto from 'crypto';

import { prisma } from '../db';

const DEFAULT_START_URL = 'https://dev.wix.com/docs';

function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    u.hash = '';
    // drop common tracking params
    u.searchParams.delete('utm_source');
    u.searchParams.delete('utm_medium');
    u.searchParams.delete('utm_campaign');
    u.searchParams.delete('utm_term');
    u.searchParams.delete('utm_content');
    return u.toString();
  } catch {
    return null;
  }
}

function hashText(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function stripHtmlToText(html: string): { title: string | null; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const titleRaw = titleMatch?.[1];
  const title = titleRaw ? titleRaw.replace(/\s+/g, ' ').trim() : null;

  // naive tag stripping
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  return { title, text };
}

function extractLinks(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const re = /href\s*=\s*"([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (!href) continue;
    const abs = normalizeUrl(new URL(href, baseUrl).toString());
    if (abs) out.push(abs);
  }
  return out;
}

function isDevWixArticleUrl(u: URL): boolean {
  if (u.hostname !== 'dev.wix.com') return false;
  const p = u.pathname;
  // We want articles across all sections: /docs/<section>/articles/...
  return p.startsWith('/docs/') && p.includes('/articles/');
}

export type IngestDevWixArticlesOptions = {
  startUrl?: string;
  limitPages?: number;
};

export async function ingestDevWixArticles(opts: IngestDevWixArticlesOptions = {}) {
  const startUrl = opts.startUrl ?? DEFAULT_START_URL;
  const limitPages = Math.max(1, Math.min(opts.limitPages ?? 5, 200));

  const queue: string[] = [startUrl];
  const seen = new Set<string>();

  let fetched = 0;
  let stored = 0;
  let skippedUnchanged = 0;

  while (queue.length > 0 && fetched < limitPages) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);

    let u: URL;
    try {
      u = new URL(url);
    } catch {
      continue;
    }

    // allow startUrl (docs root), and any article pages
    const isStart = url === startUrl;
    const isArticle = isDevWixArticleUrl(u);
    if (!isStart && !isArticle) continue;

    const res = await fetch(url, {
      headers: {
        // some CDNs vary behavior by accept
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
    }

    const html = await res.text();
    fetched += 1;

    // discover more URLs from docs root and from article pages
    const discovered = extractLinks(html, url);
    for (const d of discovered) {
      if (seen.has(d)) continue;
      try {
        const du = new URL(d);
        if (du.hostname !== 'dev.wix.com') continue;
        // crawl only docs area and only if it's an article page
        if (!du.pathname.startsWith('/docs/')) continue;
        if (!du.pathname.includes('/articles/')) continue;
        queue.push(d);
      } catch {
        // ignore
      }
    }

    // store only article pages
    if (!isArticle) continue;

    const { title, text } = stripHtmlToText(html);
    const contentHash = hashText(text);

    const existing = await prisma.docPage.findUnique({ where: { url } });
    if (existing?.contentHash === contentHash) {
      skippedUnchanged += 1;
      continue;
    }

    await prisma.docPage.upsert({
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
  }

  return {
    ok: true,
    startUrl,
    limitPages,
    fetched,
    stored,
    skippedUnchanged,
    discoveredQueued: queue.length,
  };
}
