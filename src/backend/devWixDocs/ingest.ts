import crypto from 'crypto';

import { prisma } from '../db';

type IngestResult = {
  visited: number;
  saved: number;
  skippedUnchanged: number;
  errors: number;
};

const BASE = 'https://dev.wix.com';
const START_URL = 'https://dev.wix.com/docs/articles';
const ALLOWED_PREFIX = '/docs/articles';

function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw, BASE);
    // Only same origin
    if (u.origin !== BASE) return null;
    // Strip hash
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

function isAllowed(u: URL): boolean {
  return u.origin === BASE && u.pathname.startsWith(ALLOWED_PREFIX);
}

function extractLinks(html: string): string[] {
  // Minimal & safe extraction: href="..." only
  const out: string[] = [];
  const re = /href\s*=\s*"([^"]+)"/gi;
  for (let m; (m = re.exec(html)); ) {
    const href = m[1];
    if (!href) continue;
    const normalized = normalizeUrl(href);
    if (!normalized) continue;
    const u = new URL(normalized);
    if (!isAllowed(u)) continue;
    out.push(u.toString());
  }
  return Array.from(new Set(out));
}

function stripHtmlToText(html: string): { title: string | null; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : null;

  // naive tag stripping
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

  return { title, text };
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export async function ingestDevWixDocsArticles(opts?: {
  limitPages?: number;
  maxQueue?: number;
}): Promise<IngestResult> {
  const limitPages = opts?.limitPages ?? 20;
  const maxQueue = opts?.maxQueue ?? 200;

  const queue: string[] = [START_URL];
  const seen = new Set<string>(queue);

  const res: IngestResult = {
    visited: 0,
    saved: 0,
    skippedUnchanged: 0,
    errors: 0,
  };

  while (queue.length > 0 && res.visited < limitPages) {
    const url = queue.shift()!;
    res.visited += 1;

    try {
      const r = await fetch(url, {
        method: 'GET',
        headers: {
          // Some CDNs behave better with a UA
          'user-agent': 'botcow_assistance/1.0 (+docs ingestion)',
          accept: 'text/html,application/xhtml+xml',
        },
      });

      if (!r.ok) {
        res.errors += 1;
        continue;
      }

      const html = await r.text();
      const { title, text } = stripHtmlToText(html);
      const contentHash = sha256(text);

      const existing = await prisma.docPage.findUnique({ where: { url } });
      if (existing && existing.contentHash === contentHash) {
        res.skippedUnchanged += 1;
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
        res.saved += 1;
      }

      // Expand queue
      const links = extractLinks(html);
      for (const link of links) {
        if (seen.has(link)) continue;
        if (seen.size >= maxQueue) break;
        seen.add(link);
        queue.push(link);
      }
    } catch {
      res.errors += 1;
    }
  }

  return res;
}
