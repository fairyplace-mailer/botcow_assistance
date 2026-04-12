import { prisma } from '../db';
import { embedText } from '../openai';
import { hashText } from './hash';
import { htmlToMarkdown } from './markdown';
import { chunkTextByTokens } from './tokenChunker';
import { canonicalizeDocsUrl, isAllowedDocsUrl } from './sitemapSeed';
import { DEV_WIX_SOURCE_KEY } from './seedManifest';

export type IngestStopReason = 'embed_budget_exhausted' | 'time_budget_exhausted' | 'source_missing';
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

function embeddingToSqlVectorLiteral(embedding: number[]): string {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('embeddingToSqlVectorLiteral: embedding[] required');
  }

  const body = embedding
    .map((value) => {
      if (!Number.isFinite(value)) throw new Error('embedding contains non-finite number');
      const str = String(value);
      if (str.includes('Infinity') || str.includes('NaN')) {
        throw new Error('embedding contains invalid number');
      }
      return str;
    })
    .join(',');

  return `'[${body}]'::vector`;
}

function nowMs(): number {
  return Date.now();
}

function isDefinitivelyGone(status: number): boolean {
  return status === 404 || status === 410;
}

function acceptableContentType(contentType: string | null): boolean {
  if (!contentType) return true;
  return contentType.includes('text/html') || contentType.includes('application/xhtml+xml');
}

function stripHeavyHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '');
}

function buildVectorUpdateSql(params: {
  updates: Array<{ id: string; vectorLiteral: string }>;
}): { sql: string; values: any[] } {
  const values: any[] = [];
  const rows: string[] = [];

  for (const update of params.updates) {
    const i = values.length;
    values.push(update.id, update.vectorLiteral);
    rows.push(`($${i + 1}, $${i + 2})`);
  }

  return {
    sql: `
UPDATE "knowledge_chunks" AS c
SET embedding = v.embedding::vector
FROM (VALUES
  ${rows.join(',\n  ')}
) AS v(id, embedding)
WHERE c.id = v.id
`,
    values,
  };
}

async function ensureStartDocument(startUrl: string, sourceId: string): Promise<void> {
  const canonical = canonicalizeDocsUrl(startUrl);
  if (!canonical || !isAllowedDocsUrl(canonical)) return;

  const existing = await prisma.knowledgeDocument.findFirst({
    where: { sourceId, canonicalUrl: canonical },
    select: { id: true },
  });

  if (existing) return;

  await prisma.knowledgeDocument.create({
    data: {
      sourceId,
      originalUrl: canonical,
      canonicalUrl: canonical,
      sourceSection: 'dev_wix_docs',
      documentStatus: 'pending',
    },
  });
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
  const startUrl = opts?.startUrl ?? DEFAULT_START_URL;
  const limitPages = Math.max(1, Math.min(50, Number(opts?.limitPages ?? 10)));
  const maxDurationMs = Math.max(500, Math.min(30000, Number(opts?.maxDurationMs ?? 15000)));
  const maxEmbeddings = Math.max(0, Math.min(200, Number(opts?.maxEmbeddings ?? 32)));
  const maxChunksPerPage = Math.max(1, Math.min(50, Number(opts?.maxChunksPerPage ?? 12)));
  const chunkTokens = Math.max(500, Math.min(1000, Number(opts?.chunkTokens ?? 800)));
  const overlapTokens = Math.max(0, Math.min(200, Number(opts?.overlapTokens ?? 80)));
  const deadline = nowMs() + maxDurationMs;

  let fetched = 0;
  let stored = 0;
  let skippedUnchanged = 0;
  let chunksUpserted = 0;
  let embedFailures = 0;
  let lastEmbedErrorName: string | null = null;
  let lastEmbedError: string | null = null;
  let embeddingsAttempted = 0;
  let startFetched = false;
  let startStatus: number | null = null;
  let startHtmlBytes: number | null = null;
  let startFetchErrorName: string | null = null;
  let startFetchError: string | null = null;
  let msFetch = 0;
  let msTransform = 0;
  let msChunk = 0;
  let msEmbed = 0;
  let msDb = 0;
  let stoppedReason: IngestStopReason | undefined;

  const tDb0 = nowMs();
  const source = await prisma.knowledgeSource.findUnique({ where: { sourceKey: DEV_WIX_SOURCE_KEY } });
  const [officialPages, officialChunks] = source
    ? await Promise.all([
        prisma.knowledgeDocument.count({ where: { sourceId: source.id, documentStatus: 'ready' } }),
        prisma.knowledgeChunk.count({ where: { document: { sourceId: source.id } } }),
      ])
    : [0, 0];
  msDb += nowMs() - tDb0;

  if (!source) {
    return {
      ok: true,
      startUrl,
      limitPages,
      fetched,
      stored,
      skippedUnchanged,
      chunksUpserted,
      discoveredQueued: 0,
      stoppedReason: 'source_missing',
      budgetMode: 'normal',
      officialPages,
      officialChunks,
      embeddingPressureRatio: 0,
      startFetched,
      startStatus,
      startHtmlBytes,
      startFetchErrorName,
      startFetchError,
      linksFoundTotal: 0,
      linksMatchedAllowed: 0,
      sampleLinks: [],
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
      msDiscover: 0,
      embeddingBatches: 0,
      embeddingBatchSize: 1,
    };
  }

  await ensureStartDocument(startUrl, source.id);

  const targets = await prisma.knowledgeDocument.findMany({
    where: {
      sourceId: source.id,
      ...(opts?.force
        ? {}
        : {
            documentStatus: { in: ['pending', 'failed', 'fetched', 'extracted', 'embedded', 'ready'] },
          }),
    },
    orderBy: [{ fetchedAt: 'asc' }, { createdAt: 'asc' }],
    take: limitPages,
  });

  for (const doc of targets) {
    if (nowMs() > deadline) {
      stoppedReason = 'time_budget_exhausted';
      break;
    }

    try {
      const fetchStarted = nowMs();
      const response = await fetch(doc.canonicalUrl, {
        headers: {
          'User-Agent': 'botcow_assistance/1.0 (+https://botcow-assistance.vercel.app)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });
      msFetch += nowMs() - fetchStarted;

      fetched += 1;
      if (!startFetched) {
        startFetched = true;
        startStatus = response.status;
      }

      if (isDefinitivelyGone(response.status)) {
        const started = nowMs();
        await prisma.knowledgeChunk.deleteMany({ where: { documentId: doc.id } });
        await prisma.knowledgeDocument.update({
          where: { id: doc.id },
          data: {
            lastHttpStatus: response.status,
            documentStatus: 'deleted',
            lastError: `http_${response.status}`,
          },
        });
        msDb += nowMs() - started;
        continue;
      }

      if (!response.ok || !acceptableContentType(response.headers.get('content-type'))) {
        const started = nowMs();
        await prisma.knowledgeDocument.update({
          where: { id: doc.id },
          data: {
            lastHttpStatus: response.status,
            documentStatus: 'failed',
            lastError: !response.ok ? `http_${response.status}` : 'invalid_content_type',
          },
        });
        msDb += nowMs() - started;
        continue;
      }

      const htmlRaw = await response.text();
      if (!startHtmlBytes) startHtmlBytes = htmlRaw.length;
      const html = stripHeavyHtml(htmlRaw);

      const transformStarted = nowMs();
      const { title, markdown } = htmlToMarkdown(html);
      msTransform += nowMs() - transformStarted;

      if (!markdown.trim()) {
        const started = nowMs();
        await prisma.knowledgeDocument.update({
          where: { id: doc.id },
          data: {
            lastHttpStatus: response.status,
            documentStatus: 'failed',
            lastError: 'empty_markdown',
          },
        });
        msDb += nowMs() - started;
        continue;
      }

      const contentHash = hashText(markdown);
      if (doc.contentHash && doc.contentHash === contentHash && doc.documentStatus === 'ready') {
        const started = nowMs();
        await prisma.knowledgeDocument.update({
          where: { id: doc.id },
          data: {
            title,
            lastHttpStatus: response.status,
            fetchedAt: new Date(),
            documentStatus: 'ready',
            lastError: null,
          },
        });
        msDb += nowMs() - started;
        skippedUnchanged += 1;
        continue;
      }

      const fetchedAt = new Date();
      const extractedStarted = nowMs();
      await prisma.knowledgeDocument.update({
        where: { id: doc.id },
        data: {
          title,
          normalizedMarkdown: markdown,
          contentHash,
          lastHttpStatus: response.status,
          fetchedAt,
          documentStatus: 'extracted',
          lastError: null,
        },
      });
      msDb += nowMs() - extractedStarted;

      const chunkStarted = nowMs();
      const chunks = chunkTextByTokens(markdown, { chunkTokens, overlapTokens }).slice(0, maxChunksPerPage);
      msChunk += nowMs() - chunkStarted;
      const finalChunks = chunks.length ? chunks : [{ text: markdown.trim(), tokenCount: Math.max(1, Math.ceil(markdown.length / 4)) }];

      const rebuildStarted = nowMs();
      await prisma.knowledgeChunk.deleteMany({ where: { documentId: doc.id } });
      await prisma.knowledgeChunk.createMany({
        data: finalChunks.map((chunk, index) => ({
          documentId: doc.id,
          chunkIndex: index,
          chunkText: chunk.text,
          tokenCount: chunk.tokenCount,
          textHash: hashText(chunk.text),
        })),
      });
      msDb += nowMs() - rebuildStarted;

      const chunkRows = await prisma.knowledgeChunk.findMany({
        where: { documentId: doc.id },
        orderBy: { chunkIndex: 'asc' },
        select: { id: true, chunkText: true },
      });

      const updates: Array<{ id: string; vectorLiteral: string }> = [];
      for (const chunk of chunkRows) {
        if (embeddingsAttempted >= maxEmbeddings) {
          stoppedReason = 'embed_budget_exhausted';
          break;
        }
        embeddingsAttempted += 1;
        try {
          const embedStarted = nowMs();
          const embedded = await embedText(chunk.chunkText);
          msEmbed += nowMs() - embedStarted;
          if (embedded.vector.length) {
            updates.push({
              id: chunk.id,
              vectorLiteral: embeddingToSqlVectorLiteral(embedded.vector),
            });
            chunksUpserted += 1;
          }
        } catch (error: any) {
          embedFailures += 1;
          lastEmbedErrorName = error?.name ?? 'Error';
          lastEmbedError = error?.message ?? String(error);
        }
      }

      if (updates.length !== chunkRows.length) {
        const started = nowMs();
        await prisma.knowledgeDocument.update({
          where: { id: doc.id },
          data: {
            documentStatus: 'failed',
            lastError: lastEmbedError ?? stoppedReason ?? 'embedding_incomplete',
          },
        });
        msDb += nowMs() - started;
        if (stoppedReason === 'embed_budget_exhausted') break;
        continue;
      }

      if (updates.length > 0) {
        const started = nowMs();
        const sql = buildVectorUpdateSql({ updates });
        await prisma.$executeRawUnsafe(sql.sql, ...sql.values);
        await prisma.knowledgeDocument.update({
          where: { id: doc.id },
          data: {
            embeddedAt: new Date(),
            documentStatus: 'ready',
            lastError: null,
          },
        });
        msDb += nowMs() - started;
      }

      stored += 1;
    } catch (error: any) {
      if (!startFetchError) {
        startFetchErrorName = error?.name ?? 'Error';
        startFetchError = error?.message ?? String(error);
      }
      const started = nowMs();
      await prisma.knowledgeDocument.update({
        where: { id: doc.id },
        data: {
          documentStatus: 'failed',
          lastError: error?.message ?? String(error),
        },
      }).catch(() => undefined);
      msDb += nowMs() - started;
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
    discoveredQueued: 0,
    stoppedReason,
    budgetMode: 'normal',
    officialPages,
    officialChunks,
    embeddingPressureRatio: 0,
    startFetched,
    startStatus,
    startHtmlBytes,
    startFetchErrorName,
    startFetchError,
    linksFoundTotal: 0,
    linksMatchedAllowed: 0,
    sampleLinks: [],
    embedFailures,
    lastEmbedErrorName,
    lastEmbedError,
    maxDurationMs,
    maxEmbeddings,
    embeddingsAttempted,
    budgetHit: stoppedReason === 'time_budget_exhausted' || stoppedReason === 'embed_budget_exhausted',
    budgetHitType:
      stoppedReason === 'time_budget_exhausted'
        ? 'time'
        : stoppedReason === 'embed_budget_exhausted'
          ? 'embeddings'
          : null,
    maxChunksPerPage,
    chunkTokens,
    overlapTokens,
    msFetch,
    msTransform,
    msChunk,
    msEmbed,
    msDb,
    msDiscover: 0,
    embeddingBatches: embeddingsAttempted > 0 ? embeddingsAttempted : 0,
    embeddingBatchSize: 1,
  };
}
