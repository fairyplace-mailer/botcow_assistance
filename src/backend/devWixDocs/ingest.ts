import { prisma } from '../db';
import { embedText } from '../openai';
import { kvGetJson, kvSetJson } from '../kv';
import { deleteMarkdownBlob, putDevWixMarkdown } from './blob';
import { hashText } from './hash';
import { htmlToMarkdown } from './markdown';
import { chunkTextByTokens } from './tokenChunker';

export type IngestStopReason =
  | 'skipped_daily_gate'
  | 'start_fetch_failed'
  | 'maxChunksPerRun';

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
};

const DEFAULT_START_URL = 'https://dev.wix.com/docs';
const KV_LAST_RUN_KEY = 'devwix:ingest:lastRunAt';

function markdownToTextForChunking(md: string): string {
  // Simple heuristic: markdown as plain text.
  // Approx-token chunking is applied after this step.
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/[#>*_~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isDefinitivelyGone(status: number): boolean {
  return status === 404 || status === 410;
}

function vectorLiteral(vec: number[]): string {
  // pgvector accepts: '[1,2,3]'::vector
  return `[${vec.join(',')}]`;
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

async function deleteDocPageAndAssets(url: string): Promise<void> {
  const existing = await prisma.docPage.findUnique({ where: { url } });
  if (existing?.blobPath) {
    await deleteMarkdownBlob(existing.blobPath).catch(() => undefined);
  }
  await prisma.docPage.delete({ where: { url } }).catch(() => undefined);
}

export async function ingestDevWixArticles(
  opts?: {
    limitPages?: number;
    maxChunksPerRun?: number;
    force?: boolean;
  },
): Promise<IngestResult> {
  // Per wix_spec: 5–10 pages per run.
  const limitPages = Math.max(1, Math.min(10, Number(opts?.limitPages ?? 10)));
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

  // diagnostics (legacy fields kept for API compatibility)
  let startFetched = false;
  let startStatus: number | null = null;
  let startHtmlBytes: number | null = null;
  let startFetchErrorName: string | null = null;
  let startFetchError: string | null = null;
  const linksFoundTotal = 0;
  const linksMatchedAllowed = 0;
  const sampleLinks: string[] = [];
  let stoppedReason: IngestStopReason | undefined;

  // Keep a seed record for the landing page (optional).
  try {
    const res = await fetch(startUrl, {
      headers: {
        'User-Agent': 'botcow_assistance/1.0 (+https://botcow-assistance.vercel.app)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    startFetched = true;
    startStatus = res.status;
    if (res.ok) {
      const html = await res.text();
      startHtmlBytes = html.length;

      const lang = extractHtmlLang(html);
      if (!isEnglishLang(lang)) {
        // If Wix ever localizes the landing page, ignore it.
        await deleteDocPageAndAssets(startUrl);
      } else {
        const { title, markdown } = htmlToMarkdown(html);
        const contentHash = hashText(markdown);

        const blob = await putDevWixMarkdown(startUrl, markdown);

        await prisma.docPage.upsert({
          where: { url: startUrl },
          create: {
            url: startUrl,
            title,
            text: markdownToTextForChunking(markdown),
            contentHash,
            blobPath: blob.blobPath,
            fetchedAt: runStartedAt,
            lastSeenAt: runStartedAt,
          },
          update: {
            title,
            text: markdownToTextForChunking(markdown),
            contentHash,
            blobPath: blob.blobPath,
            fetchedAt: runStartedAt,
            lastSeenAt: runStartedAt,
          },
        });
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
    };
  }

  // Choose next URLs to update (controlled fetcher, no spidering).
  // Skip pages that have not been seeded yet: we only process /docs/... URLs.
  const targets = await prisma.docPage.findMany({
    where: {
      url: { startsWith: 'https://dev.wix.com/docs/' },
    },
    orderBy: [{ fetchedAt: 'asc' }],
    take: limitPages,
  });

  const discoveredQueued = targets.length;

  for (const t of targets) {
    if (fetched >= limitPages) break;

    const url = t.url;
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'botcow_assistance/1.0 (+https://botcow-assistance.vercel.app)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });

      if (isDefinitivelyGone(res.status)) {
        // Per wix_spec: if page is removed -> delete it and its chunks AND blob.
        await deleteDocPageAndAssets(url);
        continue;
      }

      if (!res.ok) {
        // transient errors: do not delete, do not update fetchedAt (so it will be retried)
        continue;
      }

      const html = await res.text();
      fetched += 1;

      const lang = extractHtmlLang(html);
      if (!isEnglishLang(lang)) {
        // Per request: ignore localized versions.
        await deleteDocPageAndAssets(url);
        continue;
      }

      const { title, markdown } = htmlToMarkdown(html);
      const contentHash = hashText(markdown);

      const existing = await prisma.docPage.findUnique({ where: { url } });
      if (existing?.contentHash === contentHash) {
        await prisma.docPage
          .update({ where: { url }, data: { lastSeenAt: runStartedAt } })
          .catch(() => undefined);
        skippedUnchanged += 1;
        continue;
      }

      // Update blob for canonical markdown.
      const blob = await putDevWixMarkdown(url, markdown);

      const page = await prisma.docPage.upsert({
        where: { url },
        create: {
          url,
          title,
          text: markdownToTextForChunking(markdown),
          contentHash,
          blobPath: blob.blobPath,
          fetchedAt: runStartedAt,
          lastSeenAt: runStartedAt,
        },
        update: {
          title,
          text: markdownToTextForChunking(markdown),
          contentHash,
          blobPath: blob.blobPath,
          fetchedAt: runStartedAt,
          lastSeenAt: runStartedAt,
        },
      });

      stored += 1;

      // recreate chunks for this page
      await prisma.docChunk.deleteMany({ where: { pageId: page.id } });

      const chunkSource = markdownToTextForChunking(markdown);
      const tokenChunks = chunkTextByTokens(chunkSource, { chunkTokens: 800, overlapTokens: 120 });

      let idx = 0;
      for (const c of tokenChunks) {
        if (chunksUpserted >= maxChunksPerRun) {
          stoppedReason = 'maxChunksPerRun';
          break;
        }
        const content = c.text;
        if (!content || !content.trim()) continue;

        const emb = await embedText(content);

        const created = await prisma.docChunk.create({
          data: {
            pageId: page.id,
            idx,
            content,
            embeddingModel: emb.model,
            dims: emb.dims,
          },
        });

        // Store embedding vector via raw SQL to pgvector column.
        // Prisma does not natively support pgvector in schema, so we use Unsupported + $executeRaw.
        await prisma.$executeRawUnsafe(
          `UPDATE \"DocChunk\" SET \"embedding\" = '${vectorLiteral(emb.vector)}'::vector WHERE id = '${created.id}'`,
        );

        chunksUpserted += 1;
        idx += 1;
      }

      if (stoppedReason) break;
    } catch {
      // do not delete; try again later
      continue;
    }
  }

  // record last run
  await kvSetJson(KV_LAST_RUN_KEY, new Date().toISOString());

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
  };
  if (stoppedReason) result.stoppedReason = stoppedReason;
  return result;
}
