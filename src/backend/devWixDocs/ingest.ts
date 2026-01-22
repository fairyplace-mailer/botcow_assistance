import { prisma } from '../db';
import { embedText } from '../openai';
import { hashText } from './hash';
import { htmlToMarkdown } from './markdown';
import { chunkTextByTokens } from './tokenChunker';
import { embeddingToSqlVectorLiteral } from './pgvector';
import type { Prisma } from '@prisma/client';
import { canonicalizeDocsUrl, extractLinksFromHtml, isAllowedDocsUrl } from './sitemapSeed';

export type IngestStopReason =
  | 'start_fetch_failed'
  | 'maxChunksPerRun'
  | 'time_budget_exhausted'
  | 'embed_budget_exhausted';

export type IngestResult = {
  ok: true;
  startUrl: string;
  limitPages: number;
  fetched: number;
  stored: number;
  skippedUnchanged: number;
  chunksUpserted: number;
  discoveredQueued: number;
  stoppedReason?: IngestStopReason;

  // diagnostics
  startFetched: boolean;
  startStatus: number | null;
  startHtmlBytes: number | null;
  startFetchErrorName: string | null;
  startFetchError: string | null;
  linksFoundTotal: number;
  linksMatchedAllowed: number;
  sampleLinks: string[];

  // embeddings diagnostics
  embedFailures: number;
  lastEmbedErrorName: string | null;
  lastEmbedError: string | null;

  // budget diagnostics
  maxDurationMs: number;
  maxEmbeddings: number;
  embeddingsAttempted: number;
  budgetHit: boolean;
  budgetHitType: 'time' | 'embeddings' | null;

  // perf diagnostics
  msFetch: number;
  msTransform: number;
  msChunk: number;
  msEmbed: number;
  msDb: number;
  msDiscover: number;
};

const DEFAULT_START_URL = 'https://dev.wix.com/docs';

function nowMs(): number {
  return Date.now();
}

function normalizeMarkdownForHash(md: string): string {
  // Canonicalize markdown to avoid re-embedding due to insignificant whitespace changes.
  // Keep code blocks intact (code is critical for Wix docs).
  return (
    md
      .replace(/\r\n?/g, '\n')
      // trim trailing whitespace per line
      .replace(/[^\S\n]+$/gm, '')
      // collapse 3+ blank lines to 2
      .replace(/\n{3,}/g, '\n\n')
      .trim() +
    '\n'
  );
}

function markdownToTextForChunking(md: string): string {
  // Important: code examples are part of the docs and MUST be embedded.
  // We keep fenced/inline code, but we still simplify links and whitespace.
  return md
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/[#>*_~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isDefinitivelyGone(status: number): boolean {
  return status === 404 || status === 410;
}

function extractHtmlLang(html: string): string | null {
  const m = html.match(/<html\b[^>]*\blang\s*=\s*['\"]?([^'\"\s>]+)[^>]*>/i);
  return m?.[1]?.trim() ?? null;
}

function isEnglishLang(lang: string | null): boolean {
  if (!lang) return true; // if not provided, accept (wix pages usually are EN)
  const norm = lang.toLowerCase();
  return norm === 'en' || norm.startsWith('en-');
}

function addMinutes(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60 * 1000);
}

function addHours(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

function stripHeavyHtml(html: string): string {
  // Wix pages contain lots of JS and inline SVG; removing them drastically speeds up HTML->MD.
  // Keep this conservative: remove only obvious heavy blocks.
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '');
}

async function claimDueDocPages(params: {
  now: Date;
  limit: number;
}): Promise<Array<{ id: string; url: string; refreshIntervalHours: number }>> {
  const { now, limit } = params;

  // Claim: inside a transaction, select due pages and immediately push their nextFetchAt
  // forward a bit, so concurrent runs don't pick the same pages.
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const due = await tx.docPage.findMany({
      where: {
        url: { startsWith: 'https://dev.wix.com/docs/' },
        OR: [{ nextFetchAt: null }, { nextFetchAt: { lte: now } }],
      },
      orderBy: [{ nextFetchAt: 'asc' }, { fetchedAt: 'asc' }],
      take: limit,
      select: { id: true, url: true, refreshIntervalHours: true },
    });

    if (due.length === 0) return [];

    const claimedUntil = addMinutes(now, 10);

    await tx.docPage.updateMany({
      where: { id: { in: due.map((p) => p.id) } },
      data: { nextFetchAt: claimedUntil },
    });

    return due;
  });
}

async function queueDiscoveredLinks(params: {
  baseUrl: string;
  html: string;
  now: Date;
  maxNewPages: number;
  timeBudget: { shouldStop: () => boolean };
}): Promise<{ linksFoundTotal: number; linksMatchedAllowed: number; inserted: number; sampleLinks: string[] }> {
  const { baseUrl, html, now, maxNewPages, timeBudget } = params;

  let linksFoundTotal = 0;
  let linksMatchedAllowed = 0;
  let inserted = 0;
  const sampleLinks: string[] = [];

  const rawLinks = extractLinksFromHtml(html, baseUrl);
  linksFoundTotal = rawLinks.length;

  for (const raw of rawLinks) {
    if (timeBudget.shouldStop()) break;
    if (inserted >= maxNewPages) break;

    const canon = canonicalizeDocsUrl(raw);
    if (!canon) continue;
    if (!isAllowedDocsUrl(canon)) continue;

    linksMatchedAllowed += 1;
    if (sampleLinks.length < 20) sampleLinks.push(canon);

    // Upsert with minimal changes; ingest owns scheduling.
    const existing = await prisma.docPage.findUnique({ where: { url: canon } });
    if (existing) {
      await prisma.docPage.update({ where: { url: canon }, data: { lastSeenAt: now } }).catch(() => undefined);
      continue;
    }

    await prisma.docPage
      .create({
        data: {
          url: canon,
          title: null,
          text: '',
          contentHash: 'seed',
          fetchedAt: new Date(0),
          lastSeenAt: now,
          nextFetchAt: now,
          // default refreshIntervalHours applies
        },
      })
      .catch(() => undefined);

    inserted += 1;
  }

  return { linksFoundTotal, linksMatchedAllowed, inserted, sampleLinks };
}

function buildVectorUpdateSql(params: {
  updates: Array<{ id: string; vectorLiteral: string; model: string; dims: number }>;
}): { sql: string; values: any[] } {
  const { updates } = params;
  // Build:
  // UPDATE "DocChunk" AS c
  // SET embedding = v.embedding::vector,
  //     embeddingModel = v.model,
  //     dims = v.dims
  // FROM (VALUES ($1,$2,$3,$4), ...) AS v(id, embedding, model, dims)
  // WHERE c.id = v.id

  const values: any[] = [];
  const rows: string[] = [];

  for (const u of updates) {
    const i = values.length;
    values.push(u.id, u.vectorLiteral, u.model, u.dims);
    rows.push(`($${i + 1}, $${i + 2}, $${i + 3}, $${i + 4})`);
  }

  const sql = `
UPDATE "DocChunk" AS c
SET
  "embedding" = v.embedding::vector,
  "embeddingModel" = v.model,
  "dims" = v.dims
FROM (VALUES
  ${rows.join(',\n  ')}
) AS v(id, embedding, model, dims)
WHERE c.id = v.id
`;

  return { sql, values };
}

export async function ingestDevWixArticles(
  opts?: {
    limitPages?: number;
    maxChunksPerRun?: number;
    force?: boolean;
    maxDurationMs?: number;
    maxEmbeddings?: number;
    maxDiscoveredPages?: number;
    discoverLinks?: boolean;
  },
): Promise<IngestResult> {
  // Per wix_spec: 5–10 pages per run.
  const limitPages = Math.max(1, Math.min(10, Number(opts?.limitPages ?? 5)));
  const maxChunksPerRun = Math.max(1, Math.min(5000, Number(opts?.maxChunksPerRun ?? 400)));

  // Vercel Hobby hard timeout ~10s; keep real work within ~6–7s.
  const maxDurationMs = Math.max(500, Math.min(9000, Number(opts?.maxDurationMs ?? 6500)));

  // Total embeddings per run (across all pages). Keep low for Hobby.
  const maxEmbeddings = Math.max(0, Math.min(500, Number(opts?.maxEmbeddings ?? 15)));

  // Limit discovered pages enqueued during ingest; seed already handles discovery.
  const maxDiscoveredPages = Math.max(0, Math.min(500, Number(opts?.maxDiscoveredPages ?? 50)));

  // Discovery during ingest is expensive; default OFF (seed handles it).
  const discoverLinks = Boolean(opts?.discoverLinks ?? false);

  const startUrl = DEFAULT_START_URL;

  const runStartedAt = new Date();
  const deadlineMs = nowMs() + maxDurationMs;
  const timeBudget = { shouldStop: () => nowMs() > deadlineMs };

  let fetched = 0;
  let stored = 0;
  let skippedUnchanged = 0;
  let chunksUpserted = 0;

  let embedFailures = 0;
  let lastEmbedErrorName: string | null = null;
  let lastEmbedError: string | null = null;
  let embeddingsAttempted = 0;

  // diagnostics
  let startFetched = false;
  let startStatus: number | null = null;
  let startHtmlBytes: number | null = null;
  let startFetchErrorName: string | null = null;
  let startFetchError: string | null = null;
  let linksFoundTotal = 0;
  let linksMatchedAllowed = 0;
  const sampleLinks: string[] = [];
  let stoppedReason: IngestStopReason | undefined;

  // perf
  let msFetch = 0;
  let msTransform = 0;
  let msChunk = 0;
  let msEmbed = 0;
  let msDb = 0;
  let msDiscover = 0;

  // Keep a seed record for the landing page (optional).
  try {
    if (timeBudget.shouldStop()) {
      return {
        ok: true,
        startUrl,
        limitPages,
        fetched,
        stored,
        skippedUnchanged,
        chunksUpserted,
        discoveredQueued: 0,
        stoppedReason: 'time_budget_exhausted',
        startFetched,
        startStatus,
        startHtmlBytes,
        startFetchErrorName,
        startFetchError,
        linksFoundTotal,
        linksMatchedAllowed,
        sampleLinks,
        embedFailures,
        lastEmbedErrorName,
        lastEmbedError,
        maxDurationMs,
        maxEmbeddings,
        embeddingsAttempted,
        budgetHit: true,
        budgetHitType: 'time',
        msFetch,
        msTransform,
        msChunk,
        msEmbed,
        msDb,
        msDiscover,
      };
    }

    const tFetch0 = nowMs();
    const res = await fetch(startUrl, {
      headers: {
        'User-Agent': 'botcow_assistance/1.0 (+https://botcow-assistance.vercel.app)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    msFetch += nowMs() - tFetch0;

    startFetched = true;
    startStatus = res.status;
    if (res.ok) {
      const htmlRaw = await res.text();
      startHtmlBytes = htmlRaw.length;
      const html = stripHeavyHtml(htmlRaw);

      const lang = extractHtmlLang(html);
      if (!isEnglishLang(lang)) {
        // If Wix ever localizes the landing page, ignore it.
        await prisma.docPage.delete({ where: { url: startUrl } }).catch(() => undefined);
      } else {
        const tTr0 = nowMs();
        const { title, markdown } = htmlToMarkdown(html);
        msTransform += nowMs() - tTr0;

        const canonicalMarkdown = normalizeMarkdownForHash(markdown);
        const contentHash = hashText(canonicalMarkdown);

        const tDb0 = nowMs();
        await prisma.docPage.upsert({
          where: { url: startUrl },
          create: {
            url: startUrl,
            title,
            text: markdown,
            contentHash,
            fetchedAt: runStartedAt,
            lastSeenAt: runStartedAt,
          },
          update: {
            title,
            text: markdown,
            contentHash,
            fetchedAt: runStartedAt,
            lastSeenAt: runStartedAt,
          },
        });
        msDb += nowMs() - tDb0;

        // Only run discovery on landing page if explicitly enabled.
        if (discoverLinks && maxDiscoveredPages > 0 && !timeBudget.shouldStop()) {
          const tDisc0 = nowMs();
          const queued = await queueDiscoveredLinks({
            baseUrl: startUrl,
            html,
            now: runStartedAt,
            maxNewPages: maxDiscoveredPages,
            timeBudget,
          });
          msDiscover += nowMs() - tDisc0;
          linksFoundTotal += queued.linksFoundTotal;
          linksMatchedAllowed += queued.linksMatchedAllowed;
          for (const l of queued.sampleLinks) {
            if (sampleLinks.length < 20) sampleLinks.push(l);
          }
        }
      }
    }
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
      embedFailures,
      lastEmbedErrorName,
      lastEmbedError,
      maxDurationMs,
      maxEmbeddings,
      embeddingsAttempted,
      budgetHit: false,
      budgetHitType: null,
      msFetch,
      msTransform,
      msChunk,
      msEmbed,
      msDb,
      msDiscover,
    };
  }

  // Choose next URLs to update (controlled fetcher).
  const targets = opts?.force
    ? await prisma.docPage.findMany({
        where: {
          url: { startsWith: 'https://dev.wix.com/docs/' },
        },
        orderBy: [{ fetchedAt: 'asc' }],
        take: limitPages,
        select: { id: true, url: true, refreshIntervalHours: true },
      })
    : await claimDueDocPages({ now: runStartedAt, limit: limitPages });

  const discoveredQueued = targets.length;

  let discoveredRemaining = maxDiscoveredPages;

  for (const t of targets) {
    if (timeBudget.shouldStop()) {
      stoppedReason = 'time_budget_exhausted';
      break;
    }

    if (fetched >= limitPages) break;

    const url = t.url;
    try {
      const tFetch0 = nowMs();
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'botcow_assistance/1.0 (+https://botcow-assistance.vercel.app)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });
      msFetch += nowMs() - tFetch0;

      // Track status for operational visibility.
      const tDbStatus0 = nowMs();
      await prisma.docPage
        .update({ where: { url }, data: { httpStatus: res.status } })
        .catch(() => undefined);
      msDb += nowMs() - tDbStatus0;

      if (isDefinitivelyGone(res.status)) {
        // If page is removed -> delete it and its chunks.
        const tDbDel0 = nowMs();
        await prisma.docPage.delete({ where: { url } }).catch(() => undefined);
        msDb += nowMs() - tDbDel0;
        continue;
      }

      if (!res.ok) {
        // transient errors: backoff a bit
        const tDbUpd0 = nowMs();
        await prisma.docPage
          .update({
            where: { url },
            data: { nextFetchAt: addMinutes(runStartedAt, 60) },
          })
          .catch(() => undefined);
        msDb += nowMs() - tDbUpd0;
        continue;
      }

      const htmlRaw = await res.text();
      const html = stripHeavyHtml(htmlRaw);
      fetched += 1;

      // Discovery during ingest: only if explicitly enabled.
      if (discoverLinks && discoveredRemaining > 0 && !timeBudget.shouldStop()) {
        const tDisc0 = nowMs();
        const queued = await queueDiscoveredLinks({
          baseUrl: url,
          html,
          now: runStartedAt,
          maxNewPages: discoveredRemaining,
          timeBudget,
        });
        msDiscover += nowMs() - tDisc0;
        discoveredRemaining -= queued.inserted;
        linksFoundTotal += queued.linksFoundTotal;
        linksMatchedAllowed += queued.linksMatchedAllowed;
        for (const l of queued.sampleLinks) {
          if (sampleLinks.length < 20) sampleLinks.push(l);
        }
      }

      const lang = extractHtmlLang(html);
      if (!isEnglishLang(lang)) {
        // Ignore localized versions.
        const tDbDel0 = nowMs();
        await prisma.docPage.delete({ where: { url } }).catch(() => undefined);
        msDb += nowMs() - tDbDel0;
        continue;
      }

      const tTr0 = nowMs();
      const { title, markdown } = htmlToMarkdown(html);
      msTransform += nowMs() - tTr0;

      const canonicalMarkdown = normalizeMarkdownForHash(markdown);
      const contentHash = hashText(canonicalMarkdown);

      const tDbExisting0 = nowMs();
      const existing = await prisma.docPage.findUnique({ where: { url } });
      msDb += nowMs() - tDbExisting0;

      if (existing?.contentHash === contentHash) {
        const tDbUpd0 = nowMs();
        await prisma.docPage
          .update({
            where: { url },
            data: {
              lastSeenAt: runStartedAt,
              fetchedAt: runStartedAt,
              nextFetchAt: addHours(runStartedAt, t.refreshIntervalHours ?? 24),
            },
          })
          .catch(() => undefined);
        msDb += nowMs() - tDbUpd0;
        skippedUnchanged += 1;
        continue;
      }

      const tDbUpsert0 = nowMs();
      const page = await prisma.docPage.upsert({
        where: { url },
        create: {
          url,
          title,
          text: markdown,
          contentHash,
          fetchedAt: runStartedAt,
          lastSeenAt: runStartedAt,
          nextFetchAt: addHours(runStartedAt, t.refreshIntervalHours ?? 24),
        },
        update: {
          title,
          text: markdown,
          contentHash,
          fetchedAt: runStartedAt,
          lastSeenAt: runStartedAt,
          nextFetchAt: addHours(runStartedAt, t.refreshIntervalHours ?? 24),
        },
      });
      msDb += nowMs() - tDbUpsert0;

      stored += 1;

      // recreate chunks for this page
      const tDbChunks0 = nowMs();
      await prisma.docChunk.deleteMany({ where: { pageId: page.id } });
      msDb += nowMs() - tDbChunks0;

      const tChunk0 = nowMs();
      const chunkSource = markdownToTextForChunking(markdown);
      const tokenChunks = chunkTextByTokens(chunkSource, { chunkTokens: 800, overlapTokens: 120 });
      msChunk += nowMs() - tChunk0;

      const vectorUpdates: Array<{ id: string; vectorLiteral: string; model: string; dims: number }> = [];

      let idx = 0;
      for (const c of tokenChunks) {
        if (timeBudget.shouldStop()) {
          stoppedReason = 'time_budget_exhausted';
          break;
        }

        if (chunksUpserted >= maxChunksPerRun) {
          stoppedReason = 'maxChunksPerRun';
          break;
        }

        const content = c.text;
        if (!content || !content.trim()) continue;

        const tDbChunk0 = nowMs();
        // Always store the chunk content; embeddings may be budgeted out.
        const created = await prisma.docChunk.create({
          data: {
            pageId: page.id,
            idx,
            content,
            embeddingModel: null,
            dims: null,
          },
        });
        msDb += nowMs() - tDbChunk0;

        // Respect embeddings budget (total per run)
        if (embeddingsAttempted >= maxEmbeddings) {
          stoppedReason = stoppedReason ?? 'embed_budget_exhausted';
          idx += 1;
          continue;
        }

        embeddingsAttempted += 1;

        try {
          const tEmb0 = nowMs();
          const emb = await embedText(content);
          msEmbed += nowMs() - tEmb0;

          vectorUpdates.push({
            id: created.id,
            vectorLiteral: embeddingToSqlVectorLiteral(emb.vector),
            model: emb.model,
            dims: emb.dims,
          });

          chunksUpserted += 1;
        } catch (e: any) {
          embedFailures += 1;
          lastEmbedErrorName = e?.name ?? 'Error';
          lastEmbedError = e?.message ?? String(e);
          // keep the chunk without embedding; it can be re-embedded later.
        }

        idx += 1;
      }

      // One DB roundtrip for all vectors for this page.
      if (vectorUpdates.length > 0 && !timeBudget.shouldStop()) {
        const tDbVec0 = nowMs();
        const { sql, values } = buildVectorUpdateSql({ updates: vectorUpdates });
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        await prisma.$executeRawUnsafe(sql, ...values);
        msDb += nowMs() - tDbVec0;
      }

      if (stoppedReason && (stoppedReason === 'time_budget_exhausted' || stoppedReason === 'maxChunksPerRun')) break;
    } catch {
      // do not delete; try again later
      const tDbUpd0 = nowMs();
      await prisma.docPage
        .update({
          where: { url },
          data: { nextFetchAt: addMinutes(runStartedAt, 60) },
        })
        .catch(() => undefined);
      msDb += nowMs() - tDbUpd0;
      continue;
    }
  }

  const budgetHit = stoppedReason === 'time_budget_exhausted' || stoppedReason === 'embed_budget_exhausted';
  const budgetHitType: 'time' | 'embeddings' | null =
    stoppedReason === 'time_budget_exhausted'
      ? 'time'
      : stoppedReason === 'embed_budget_exhausted'
        ? 'embeddings'
        : null;

  const result: IngestResult = {
    ok: true,
    startUrl,
    limitPages,
    fetched,
    stored,
    skippedUnchanged,
    chunksUpserted,
    discoveredQueued,
    startFetched,
    startStatus,
    startHtmlBytes,
    startFetchErrorName,
    startFetchError,
    linksFoundTotal,
    linksMatchedAllowed,
    sampleLinks,
    embedFailures,
    lastEmbedErrorName,
    lastEmbedError,
    maxDurationMs,
    maxEmbeddings,
    embeddingsAttempted,
    budgetHit,
    budgetHitType,
    msFetch,
    msTransform,
    msChunk,
    msEmbed,
    msDb,
    msDiscover,
  };
  if (stoppedReason) result.stoppedReason = stoppedReason;
  return result;
}
