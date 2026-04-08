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
  | 'embed_budget_exhausted'
  | 'maxChunksPerPage'
  | 'budget_warning_mode'
  | 'budget_aggressive_mode';

export type IngestBudgetMode = 'normal' | 'warning' | 'aggressive';

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
  budgetMode: IngestBudgetMode;
  officialPages: number;
  officialChunks: number;
  embeddingPressureRatio: number;
  startFetched: boolean;
  startStatus: number | null;
  startHtmlBytes: number | null;
  startFetchErrorName: string | null;
  startFetchError: string | null;
  linksFoundTotal: number;
  linksMatchedAllowed: number;
  sampleLinks: string[];
  embedFailures: number;
  lastEmbedErrorName: string | null;
  lastEmbedError: string | null;
  maxDurationMs: number;
  maxEmbeddings: number;
  embeddingsAttempted: number;
  budgetHit: boolean;
  budgetHitType: 'time' | 'embeddings' | null;
  maxChunksPerPage: number;
  chunkTokens: number;
  overlapTokens: number;
  msFetch: number;
  msTransform: number;
  msChunk: number;
  msEmbed: number;
  msDb: number;
  msDiscover: number;
  embeddingBatches: number;
  embeddingBatchSize: number;
};

const DEFAULT_START_URL = 'https://dev.wix.com/docs';
const TEMPORARY_TTL_DAYS = 7;
const BUDGET_WARNING_THRESHOLD = 10;
const BUDGET_AGGRESSIVE_THRESHOLD = 500;

function nowMs(): number {
  return Date.now();
}

function normalizeMarkdownForHash(md: string): string {
  return md.replace(/\r\n?/g, '\n').replace(/[^\S\n]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function markdownToTextForChunking(md: string): string {
  return md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1').replace(/[#>*_~|-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function isDefinitivelyGone(status: number): boolean {
  return status === 404 || status === 410;
}

function extractHtmlLang(html: string): string | null {
  const m = html.match(/<html\b[^>]*\blang\s*=\s*['\"]?([^'\"\s>]+)[^>]*>/i);
  return m?.[1]?.trim() ?? null;
}

function isEnglishLang(lang: string | null): boolean {
  if (!lang) return true;
  const norm = lang.toLowerCase();
  return norm === 'en' || norm.startsWith('en-');
}

function addMinutes(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60 * 1000);
}

function addHours(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function stripHeavyHtml(html: string): string {
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

  const txArg = async (tx: Prisma.TransactionClient) => {
    const due = await tx.docPage.findMany({
      where: {
        url: { startsWith: 'https://dev.wix.com/docs/' },
        knowledgeLayer: 'OFFICIAL',
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
  };

  try {
    return await (prisma as any).$transaction(txArg);
  } catch {
    const due = await prisma.docPage.findMany({
      where: {
        url: { startsWith: 'https://dev.wix.com/docs/' },
        knowledgeLayer: 'OFFICIAL',
        OR: [{ nextFetchAt: null }, { nextFetchAt: { lte: now } }],
      },
      orderBy: [{ nextFetchAt: 'asc' }, { fetchedAt: 'asc' }],
      take: limit,
      select: { id: true, url: true, refreshIntervalHours: true },
    });

    return due;
  }
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

    const existing = await prisma.docPage.findUnique({ where: { url: canon } });
    if (existing) {
      await prisma.docPage.update({ where: { url: canon }, data: { lastSeenAt: now } }).catch(() => undefined);
      continue;
    }

    await prisma.docPage.create({
      data: {
        url: canon,
        title: null,
        text: '',
        contentHash: 'seed',
        knowledgeLayer: 'TEMPORARY',
        retentionUntil: addDays(now, TEMPORARY_TTL_DAYS),
        retentionReason: 'seed_placeholder',
        fetchedAt: new Date(0),
        lastSeenAt: now,
        nextFetchAt: now,
      },
    }).catch(() => undefined);

    inserted += 1;
  }

  return { linksFoundTotal, linksMatchedAllowed, inserted, sampleLinks };
}

function buildVectorUpdateSql(params: {
  updates: Array<{ id: string; vectorLiteral: string; model: string; dims: number }>;
}): { sql: string; values: any[] } {
  const { updates } = params;
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

async function getEmbeddingPressureRatio(maxEmbeddings: number): Promise<{ ratio: number; officialPages: number; officialChunks: number }> {
  const [officialPages, officialChunks] = await Promise.all([
    prisma.docPage.count({ where: { knowledgeLayer: 'OFFICIAL' } }),
    prisma.docChunk.count({ where: { knowledgeLayer: 'OFFICIAL' } }),
  ]);
  const divisor = Math.max(1, maxEmbeddings);
  const pressureUnits = Math.max(officialChunks, officialPages);
  const ratio = pressureUnits / divisor;
  return { ratio, officialPages, officialChunks };
}

function getBudgetMode(ratio: number): IngestBudgetMode {
  if (ratio >= BUDGET_AGGRESSIVE_THRESHOLD) return 'aggressive';
  if (ratio >= BUDGET_WARNING_THRESHOLD) return 'warning';
  return 'normal';
}

function applyBudgetMode(params: {
  budgetMode: IngestBudgetMode;
  limitPages: number;
  maxChunksPerRun: number;
  maxEmbeddings: number;
  maxDiscoveredPages: number;
  discoverLinks: boolean;
  maxChunksPerPage: number;
  chunkTokens: number;
  overlapTokens: number;
}): {
  limitPages: number;
  maxChunksPerRun: number;
  maxEmbeddings: number;
  maxDiscoveredPages: number;
  discoverLinks: boolean;
  maxChunksPerPage: number;
  chunkTokens: number;
  overlapTokens: number;
  stoppedReason?: IngestStopReason;
} {
  const { budgetMode } = params;
  if (budgetMode === 'aggressive') {
    return {
      limitPages: 0,
      maxChunksPerRun: 0,
      maxEmbeddings: 0,
      maxDiscoveredPages: 0,
      discoverLinks: false,
      maxChunksPerPage: 0,
      chunkTokens: params.chunkTokens,
      overlapTokens: 0,
      stoppedReason: 'budget_aggressive_mode',
    };
  }

  if (budgetMode === 'warning') {
    return {
      limitPages: Math.max(1, Math.min(params.limitPages, 2)),
      maxChunksPerRun: Math.max(1, Math.min(params.maxChunksPerRun, 8)),
      maxEmbeddings: Math.max(0, Math.min(params.maxEmbeddings, 2)),
      maxDiscoveredPages: 0,
      discoverLinks: false,
      maxChunksPerPage: Math.max(1, Math.min(params.maxChunksPerPage, 2)),
      chunkTokens: Math.max(200, Math.min(params.chunkTokens, 950)),
      overlapTokens: Math.min(params.overlapTokens, 40),
      stoppedReason: 'budget_warning_mode',
    };
  }

  return params;
}

async function cleanupExpiredTemporaryData(now: Date): Promise<void> {
  await prisma.docChunk.deleteMany({
    where: {
      knowledgeLayer: 'TEMPORARY',
      retentionUntil: { lte: now },
    },
  });

  await prisma.docPage.deleteMany({
    where: {
      knowledgeLayer: 'TEMPORARY',
      retentionUntil: { lte: now },
    },
  });
}

function officialPageData(params: {
  url: string;
  title: string | null;
  markdown: string;
  contentHash: string;
  now: Date;
  refreshIntervalHours?: number;
}) {
  const { url, title, markdown, contentHash, now, refreshIntervalHours } = params;
  return {
    url,
    title,
    text: markdown,
    contentHash,
    knowledgeLayer: 'OFFICIAL' as Prisma.DocPageUncheckedCreateInput['knowledgeLayer'],
    retentionUntil: null,
    retentionReason: null,
    fetchedAt: now,
    lastSeenAt: now,
    nextFetchAt: addHours(now, refreshIntervalHours ?? 24),
  };
}

function officialChunkData(pageId: string, idx: number, content: string) {
  return {
    pageId,
    idx,
    content,
    knowledgeLayer: 'OFFICIAL' as Prisma.DocChunkUncheckedCreateInput['knowledgeLayer'],
    retentionUntil: null,
    lastAccessedAt: null,
    embeddingModel: null,
    dims: null,
  };
}

export async function ingestDevWixArticles(
  opts?: {
    startUrl?: string;
    limitPages?: number;
    maxChunksPerRun?: number;
    force?: boolean;
    maxDurationMs?: number;
    maxEmbeddings?: number;
    maxDiscoveredPages?: number;
    discoverLinks?: boolean;
    maxChunksPerPage?: number;
    chunkTokens?: number;
    overlapTokens?: number;
  },
): Promise<IngestResult> {
  let limitPages = Math.max(1, Math.min(10, Number(opts?.limitPages ?? 1)));
  let maxChunksPerRun = Math.max(1, Math.min(5000, Number(opts?.maxChunksPerRun ?? 400)));
  const maxDurationMs = Math.max(500, Math.min(9000, Number(opts?.maxDurationMs ?? 6500)));
  let maxEmbeddings = Math.max(0, Math.min(500, Number(opts?.maxEmbeddings ?? 8)));
  let maxDiscoveredPages = Math.max(0, Math.min(500, Number(opts?.maxDiscoveredPages ?? 50)));
  let discoverLinks = Boolean(opts?.discoverLinks ?? false);
  let maxChunksPerPage = Math.max(1, Math.min(50, Number(opts?.maxChunksPerPage ?? 8)));
  let chunkTokens = Math.max(200, Math.min(2000, Number(opts?.chunkTokens ?? 1100)));
  let overlapTokens = Math.max(0, Math.min(400, Number(opts?.overlapTokens ?? 150)));

  const startUrl = opts?.startUrl ?? DEFAULT_START_URL;
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
  let embeddingBatches = 0;
  let embeddingBatchSize = 0;
  let startFetched = false;
  let startStatus: number | null = null;
  let startHtmlBytes: number | null = null;
  let startFetchErrorName: string | null = null;
  let startFetchError: string | null = null;
  let linksFoundTotal = 0;
  let linksMatchedAllowed = 0;
  const sampleLinks: string[] = [];
  let stoppedReason: IngestStopReason | undefined;
  let msFetch = 0;
  let msTransform = 0;
  let msChunk = 0;
  let msEmbed = 0;
  let msDb = 0;
  let msDiscover = 0;

  const pressure = await getEmbeddingPressureRatio(maxEmbeddings);
  const budgetMode = getBudgetMode(pressure.ratio);
  const adjusted = applyBudgetMode({
    budgetMode,
    limitPages,
    maxChunksPerRun,
    maxEmbeddings,
    maxDiscoveredPages,
    discoverLinks,
    maxChunksPerPage,
    chunkTokens,
    overlapTokens,
  });

  limitPages = adjusted.limitPages;
  maxChunksPerRun = adjusted.maxChunksPerRun;
  maxEmbeddings = adjusted.maxEmbeddings;
  maxDiscoveredPages = adjusted.maxDiscoveredPages;
  discoverLinks = adjusted.discoverLinks;
  maxChunksPerPage = adjusted.maxChunksPerPage;
  chunkTokens = adjusted.chunkTokens;
  overlapTokens = adjusted.overlapTokens;
  stoppedReason = adjusted.stoppedReason;

  await cleanupExpiredTemporaryData(runStartedAt);

  if (budgetMode === 'aggressive') {
    return {
      ok: true,
      startUrl,
      limitPages,
      fetched,
      stored,
      skippedUnchanged,
      chunksUpserted,
      discoveredQueued: 0,
      stoppedReason,
      budgetMode,
      officialPages: pressure.officialPages,
      officialChunks: pressure.officialChunks,
      embeddingPressureRatio: pressure.ratio,
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
      budgetHitType: 'embeddings',
      maxChunksPerPage,
      chunkTokens,
      overlapTokens,
      msFetch,
      msTransform,
      msChunk,
      msEmbed,
      msDb,
      msDiscover,
      embeddingBatches,
      embeddingBatchSize,
    };
  }

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
        budgetMode,
        officialPages: pressure.officialPages,
        officialChunks: pressure.officialChunks,
        embeddingPressureRatio: pressure.ratio,
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
        maxChunksPerPage,
        chunkTokens,
        overlapTokens,
        msFetch,
        msTransform,
        msChunk,
        msEmbed,
        msDb,
        msDiscover,
        embeddingBatches,
        embeddingBatchSize,
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
        await (prisma.docPage as any).delete?.({ where: { url: startUrl } }).catch(() => undefined);
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
            knowledgeLayer: 'OFFICIAL',
            retentionUntil: null,
            retentionReason: null,
            fetchedAt: runStartedAt,
            lastSeenAt: runStartedAt,
          },
          update: {
            title,
            text: markdown,
            contentHash,
            knowledgeLayer: 'OFFICIAL',
            retentionUntil: null,
            retentionReason: null,
            fetchedAt: runStartedAt,
            lastSeenAt: runStartedAt,
          },
        });
        msDb += nowMs() - tDb0;

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
      budgetMode,
      officialPages: pressure.officialPages,
      officialChunks: pressure.officialChunks,
      embeddingPressureRatio: pressure.ratio,
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
      maxChunksPerPage,
      chunkTokens,
      overlapTokens,
      msFetch,
      msTransform,
      msChunk,
      msEmbed,
      msDb,
      msDiscover,
      embeddingBatches,
      embeddingBatchSize,
    };
  }

  const targets = opts?.force
    ? await prisma.docPage.findMany({
        where: {
          url: { startsWith: 'https://dev.wix.com/docs/' },
          knowledgeLayer: 'OFFICIAL',
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

      const tDbStatus0 = nowMs();
      await prisma.docPage.update({ where: { url }, data: { httpStatus: res.status } }).catch(() => undefined);
      msDb += nowMs() - tDbStatus0;

      if (isDefinitivelyGone(res.status)) {
        const tDbDel0 = nowMs();
        await (prisma.docPage as any).delete?.({ where: { url } }).catch(() => undefined);
        msDb += nowMs() - tDbDel0;
        continue;
      }

      if (!res.ok) {
        const tDbUpd0 = nowMs();
        await prisma.docPage.update({ where: { url }, data: { nextFetchAt: addMinutes(runStartedAt, 60) } }).catch(() => undefined);
        msDb += nowMs() - tDbUpd0;
        continue;
      }

      const htmlRaw = await res.text();
      const html = stripHeavyHtml(htmlRaw);
      fetched += 1;

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
      const english = isEnglishLang(lang);
      if (!english) {
        const tDbDel0 = nowMs();
        await (prisma.docPage as any).delete?.({ where: { url } }).catch(() => undefined);
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
        await prisma.docPage.update({
          where: { url },
          data: {
            lastSeenAt: runStartedAt,
            fetchedAt: runStartedAt,
            knowledgeLayer: 'OFFICIAL',
            retentionUntil: null,
            retentionReason: null,
            nextFetchAt: addHours(runStartedAt, t.refreshIntervalHours ?? 24),
          },
        }).catch(() => undefined);
        msDb += nowMs() - tDbUpd0;
        skippedUnchanged += 1;
        continue;
      }

      const pageData = officialPageData({ url, title, markdown, contentHash, now: runStartedAt, refreshIntervalHours: t.refreshIntervalHours });
      const tDbUpsert0 = nowMs();
      const upsertedPage = await prisma.docPage.upsert({
        where: { url },
        create: pageData,
        update: pageData,
      });
      const page = upsertedPage ?? { id: url, ...pageData };
      msDb += nowMs() - tDbUpsert0;

      stored += 1;

      const tDbChunks0 = nowMs();
      await prisma.docChunk.deleteMany({ where: { pageId: page.id } });
      msDb += nowMs() - tDbChunks0;

      const tChunk0 = nowMs();
      const chunkSource = markdownToTextForChunking(markdown);
      const tokenChunks = chunkTextByTokens(chunkSource, { chunkTokens, overlapTokens });
      msChunk += nowMs() - tChunk0;

      const chunkRows: Array<{ idx: number; content: string }> = [];
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
        if (idx >= maxChunksPerPage) {
          stoppedReason = stoppedReason ?? 'maxChunksPerPage';
          break;
        }

        const content = c.text;
        if (!content || !content.trim()) continue;
        chunkRows.push({ idx, content });
        idx += 1;
      }

      if (chunkRows.length === 0 && chunkSource.trim()) {
        chunkRows.push({ idx: 0, content: chunkSource.trim() });
      }

      if (chunkRows.length > 0) {
        const data = chunkRows.map((chunk) => officialChunkData(page.id, chunk.idx, chunk.content));
        const tDbCreateMany0 = nowMs();
        await prisma.docChunk.createMany({
          data,
        });
        msDb += nowMs() - tDbCreateMany0;
      }

      const vectorUpdates: Array<{ id: string; vectorLiteral: string; model: string; dims: number }> = [];

      for (const chunk of chunkRows) {
        if (embeddingsAttempted >= maxEmbeddings) {
          stoppedReason = stoppedReason ?? 'embed_budget_exhausted';
          break;
        }

        const oneChunkResult = await prisma.$queryRaw<any[]>`
          SELECT id, idx
          FROM "DocChunk"
          WHERE "pageId" = ${page.id} AND idx = ${chunk.idx}
          LIMIT 1
        `;
        const found = Array.isArray(oneChunkResult) ? oneChunkResult[0] : null;
        if (!found?.id) continue;

        embeddingsAttempted += 1;
        try {
          const tEmb0 = nowMs();
          const emb = await embedText(chunk.content);
          msEmbed += nowMs() - tEmb0;

          embeddingBatches += 1;
          embeddingBatchSize = 1;

          vectorUpdates.push({
            id: found.id,
            vectorLiteral: embeddingToSqlVectorLiteral(emb.vector),
            model: emb.model,
            dims: emb.dims,
          });
          chunksUpserted += 1;
        } catch (e: any) {
          embedFailures += 1;
          lastEmbedErrorName = e?.name ?? 'Error';
          lastEmbedError = e?.message ?? String(e);
        }
      }

      if (vectorUpdates.length > 0 && !timeBudget.shouldStop()) {
        const tDbVec0 = nowMs();
        const { sql, values } = buildVectorUpdateSql({ updates: vectorUpdates });
        await prisma.$executeRawUnsafe(sql, ...values);
        msDb += nowMs() - tDbVec0;
      }

      if (stoppedReason && stoppedReason !== 'embed_budget_exhausted' && stoppedReason !== 'budget_warning_mode') break;
    } catch (e: any) {
      const tDbUpd0 = nowMs();
      await prisma.docPage.update({ where: { url }, data: { nextFetchAt: addMinutes(runStartedAt, 60) } }).catch(() => undefined);
      msDb += nowMs() - tDbUpd0;
      continue;
    }
  }

  const budgetHit =
    stoppedReason === 'time_budget_exhausted' ||
    stoppedReason === 'embed_budget_exhausted' ||
    stoppedReason === 'budget_warning_mode' ||
    stoppedReason === 'budget_aggressive_mode';
  const budgetHitType: 'time' | 'embeddings' | null =
    stoppedReason === 'time_budget_exhausted'
      ? 'time'
      : stoppedReason === 'embed_budget_exhausted' || stoppedReason === 'budget_warning_mode' || stoppedReason === 'budget_aggressive_mode'
        ? 'embeddings'
        : null;

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
    budgetMode,
    officialPages: pressure.officialPages,
    officialChunks: pressure.officialChunks,
    embeddingPressureRatio: pressure.ratio,
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
    maxChunksPerPage,
    chunkTokens,
    overlapTokens,
    msFetch,
    msTransform,
    msChunk,
    msEmbed,
    msDb,
    msDiscover,
    embeddingBatches,
    embeddingBatchSize,
  };
}
