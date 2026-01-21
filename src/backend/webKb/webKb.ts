import { prisma } from "../db";
import type { PrismaClient } from "@prisma/client";

import { WEB_KB_SOURCES } from "./sources";
import { fetchHtml } from "./request";
import { ingestWebKb as ingestWebKbCore, type IngestWebKbResult } from "./ingest";

export type WebKbSeedResult = {
  sourcesTotal: number;
  sourcesCompleted: number;
  pagesVisited: number;
  pagesUpserted: number;
  pagesFetchFailed: number;
  stoppedByTimeout: boolean;
};

export type WebKbIngestResult = IngestWebKbResult;

function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (!u.hostname) return null;
    u.hash = "";

    // Drop common trackers.
    const dropParams = new Set([
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "gclid",
      "fbclid",
    ]);
    for (const k of Array.from(u.searchParams.keys())) {
      if (dropParams.has(k)) u.searchParams.delete(k);
    }

    // Sort params for canonical form.
    const sorted = Array.from(u.searchParams.entries()).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    u.search = "";
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

function isAllowedByRules(url: string, source: (typeof WEB_KB_SOURCES)[number]): boolean {
  try {
    const u = new URL(url);
    if (!isSameDomain(url, source.domain)) return false;

    const path = u.pathname || "/";
    if (!source.allowedPathPrefixes.some((p) => path.startsWith(p))) return false;

    const lower = path.toLowerCase();
    if (source.denyPathSubstrings.some((d) => lower.includes(d))) return false;

    return true;
  } catch {
    return false;
  }
}

// Seed: discover URLs and upsert WebPage rows. No embeddings.
export async function seedWebKb(opts?: {
  prisma?: PrismaClient;
  maxPagesTotal?: number;
  maxDurationMs?: number;
}): Promise<WebKbSeedResult> {
  const p = opts?.prisma ?? prisma;

  const maxPagesTotal = Math.max(50, Math.min(800, Number(opts?.maxPagesTotal ?? 400)));
  const maxDurationMs = Math.max(10_000, Math.min(120_000, Number(opts?.maxDurationMs ?? 70_000)));

  const startedAt = Date.now();
  let pagesVisited = 0;
  let pagesUpserted = 0;
  let pagesFetchFailed = 0;

  // Ensure sites exist
  for (const source of WEB_KB_SOURCES) {
    await p.webSite.upsert({
      where: { domain: source.domain },
      create: { domain: source.domain },
      update: {},
    });
  }

  const sourcesTotal = WEB_KB_SOURCES.length;
  let sourcesCompleted = 0;

  for (const source of WEB_KB_SOURCES) {
    if (Date.now() - startedAt > maxDurationMs) break;

    const site = await p.webSite.findUnique({ where: { domain: source.domain } });
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

      const fetchRes = await fetchHtml(normalized);
      if (!fetchRes.ok) {
        pagesFetchFailed += 1;
        continue;
      }

      // Upsert page record (seed only). Schedule due immediately.
      await p.webPage.upsert({
        where: { url: normalized },
        create: {
          siteId: site.id,
          url: normalized,
          title: null,
          httpStatus: fetchRes.status,
          excludedReason: null,
          lastSeenAt: new Date(),
          refreshIntervalHours: 24 * 20,
          nextFetchAt: new Date(),
        },
        update: {
          httpStatus: fetchRes.status,
          excludedReason: null,
          lastSeenAt: new Date(),
          nextFetchAt: new Date(),
        },
      });
      pagesUpserted += 1;

      // Discover links for same-domain crawl.
      const re = /href\s*=\s*"([^"]+)"/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(fetchRes.html))) {
        const href = m[1];
        if (!href) continue;
        try {
          const abs = new URL(href, normalized).toString();
          const n = normalizeUrl(abs);
          if (!n) continue;
          if (seen.has(n)) continue;
          if (!isAllowedByRules(n, source)) continue;
          queue.push(n);
        } catch {
          continue;
        }
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

// Ingest: delegate to module implementation (single source of truth).
export async function ingestWebKb(opts?: {
  prisma?: PrismaClient;
  maxPages?: number;
  maxDurationMs?: number;
  force?: boolean;
}): Promise<WebKbIngestResult> {
  const p = opts?.prisma ?? prisma;
  return ingestWebKbCore(p, {
    maxPages: Math.max(1, Math.min(30, Number(opts?.maxPages ?? 15))),
    maxDurationMs: opts?.maxDurationMs,
    force: opts?.force,
  });
}
