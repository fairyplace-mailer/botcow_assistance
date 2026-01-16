import crypto from 'node:crypto';

import { prisma } from '@/backend/db';

const DEFAULT_USER_AGENT =
  'botcow_assistance (+https://github.com/fairyplace-mailer/botcow_assistance)';

export type DevWixIngestResult = {
  fetched: number;
  skippedUnchanged: number;
  stored: number;
  discoveredUrls: number;
};

function hashText(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function normalizeUrl(u: string): string {
  // remove hash fragments (navigation only)
  const url = new URL(u);
  url.hash = '';
  return url.toString();
}

function extractArticleLinks(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const hrefRe = /href\s*=\s*"([^"]+)"/gi;

  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html))) {
    const href = m[1];
    if (!href) continue;

    try {
      const abs = new URL(href, baseUrl).toString();
      out.push(normalizeUrl(abs));
    } catch {
      // ignore
    }
  }

  return out;
}

function stripHtmlToText(html: string): { title: string | null; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const rawTitle = titleMatch?.[1];
  const title = rawTitle ? rawTitle.replace(/\s+/g, ' ').trim() : null;

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
    .replace(/\s+/g, ' ')
    .trim();

  return { title, text };
}

function isAllowedDevWixUrl(u: string): boolean {
  try {
    const url = new URL(u);
    if (url.hostname !== 'dev.wix.com') return false;
    return url.pathname.startsWith('/docs/articles');
  } catch {
    return false;
  }
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'user-agent': DEFAULT_USER_AGENT,
      accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }

  return await res.text();
}

export async function ingestDevWixArticles(opts?: {
  limitPages?: number;
}): Promise<DevWixIngestResult> {
  const limitPages = Math.max(1, Math.min(opts?.limitPages ?? 5, 200));

  const startUrl = 'https://dev.wix.com/docs/articles';

  const queue: string[] = [startUrl];
  const seen = new Set<string>();

  let fetched = 0;
  let skippedUnchanged = 0;
  let stored = 0;

  while (queue.length > 0 && fetched < limitPages) {
    const url = normalizeUrl(queue.shift()!);
    if (seen.has(url)) continue;
    seen.add(url);

    if (!isAllowedDevWixUrl(url)) continue;

    const html = await fetchHtml(url);
    fetched += 1;

    const { title, text } = stripHtmlToText(html);
    const contentHash = hashText(text);

    const existing = await prisma.docPage.findUnique({ where: { url } });
    if (existing?.contentHash === contentHash) {
      skippedUnchanged += 1;
    } else {
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

    // discover more URLs
    const links = extractArticleLinks(html, url);
    for (const l of links) {
      if (isAllowedDevWixUrl(l) && !seen.has(l)) queue.push(l);
    }
  }

  return {
    fetched,
    skippedUnchanged,
    stored,
    discoveredUrls: seen.size,
  };
}
