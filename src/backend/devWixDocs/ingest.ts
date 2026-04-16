import { prisma } from '../db';
import { createKnowledgeJob, finishKnowledgeJob } from '../knowledgeJobs';
import { embedText } from '../openai';
import { applyDevWixIngestDegradation, computeDevWixBudgetSnapshot } from './budgetPolicy';
import { hashText } from './hash';
import { htmlToMarkdown } from './markdown';
import {
  httpStatusClass,
  logDevWixDocumentStatusTransition,
  logDevWixInfo,
  logDevWixWarn,
} from './observability';
import { canonicalizeDocsUrl, isAllowedDocsUrl } from './sitemapSeed';
import { chunkTextByTokens } from './tokenChunker';
import { DEV_WIX_SOURCE_KEY } from './seedManifest';

export type IngestStopReason =
  | 'embed_budget_exhausted'
  | 'time_budget_exhausted'
  | 'source_missing'
  | 'budget_aggressive_stop';

export type IngestBudgetMode = 'normal' | 'warning' | 'aggressive';

export type IngestResult = {
  ok: true;
  jobId: string | null;
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
  dbPressureRatio: number;
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

type MutableDoc = {
  id: string;
  canonicalUrl: string;
  documentStatus: 'pending' | 'fetched' | 'extracted' | 'embedded' | 'ready' | 'failed' | 'deleted';
  contentHash: string | null;
  embeddedAt?: Date | null;
};

type ActiveChunkResumeRow = {
  id: string;
  chunkText: string;
  textHash: string;
  chunkIndex: number;
  chunkVersion: number;
  hasEmbedding: boolean;
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

  return `[${body}]`;
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

async function loadActiveChunkResumeRows(documentId: string): Promise<ActiveChunkResumeRow[]> {
  return (await prisma.$queryRawUnsafe(
    `
SELECT
  id,
  chunk_text AS "chunkText",
  text_hash AS "textHash",
  chunk_index AS "chunkIndex",
  chunk_version AS "chunkVersion",
  CASE WHEN embedding IS NULL THEN FALSE ELSE TRUE END AS "hasEmbedding"
FROM "knowledge_chunks"
WHERE document_id = $1
  AND is_active = TRUE
ORDER BY chunk_index ASC
`,
    documentId,
  )) as ActiveChunkResumeRow[];
}

function canResumeActiveChunkSet(
  existingRows: ActiveChunkResumeRow[],
  finalChunks: Array<{ text: string }>,
): boolean {
  if (existingRows.length !== finalChunks.length) return false;

  return existingRows.every((row, index) => {
    if (row.chunkIndex !== index) return false;
    return row.textHash === hashText(finalChunks[index]?.text ?? '');
  });
}

async function transitionDocument(params: {
  jobId: string | null;
  doc: MutableDoc;
  nextStatus: MutableDoc['documentStatus'];
  lastHttpStatus?: number | null;
  data: Record<string, unknown>;
}) {
  const previousStatus = params.doc.documentStatus;

  await prisma.knowledgeDocument.update({
    where: { id: params.doc.id },
    data: {
      ...params.data,
      documentStatus: params.nextStatus,
    },
  });

  params.doc.documentStatus = params.nextStatus;

  await logDevWixDocumentStatusTransition({
    jobId: params.jobId,
    canonicalUrl: params.doc.canonicalUrl,
    fromStatus: previousStatus,
    toStatus: params.nextStatus,
    lastHttpStatus: params.lastHttpStatus ?? null,
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
  const runStartedAt = nowMs();

  const requestedStartUrl = opts?.startUrl?.trim() ?? '';
  const canonicalStartUrl = requestedStartUrl ? canonicalizeDocsUrl(requestedStartUrl) : null;
  const startUrl = canonicalStartUrl && isAllowedDocsUrl(canonicalStartUrl) ? canonicalStartUrl : DEFAULT_START_URL;
  const targetCanonicalUrl = canonicalStartUrl && isAllowedDocsUrl(canonicalStartUrl) ? canonicalStartUrl : null;

  const limitPages = Math.max(1, Math.min(50, Number(opts?.limitPages ?? 10)));
  const maxDurationMs = Math.max(500, Math.min(30000, Number(opts?.maxDurationMs ?? 15000)));

  const requestedMaxEmbeddings = Math.max(0, Math.min(200, Number(opts?.maxEmbeddings ?? 32)));
  const requestedMaxChunksPerPage = Math.max(1, Math.min(50, Number(opts?.maxChunksPerPage ?? 12)));
  const requestedChunkTokens = Math.max(500, Math.min(1000, Number(opts?.chunkTokens ?? 800)));
  const requestedOverlapTokens = Math.max(0, Math.min(200, Number(opts?.overlapTokens ?? 80)));

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
  let jobId: string | null = null;

  const tDb0 = nowMs();
  const source = await prisma.knowledgeSource.findUnique({ where: { sourceKey: DEV_WIX_SOURCE_KEY } });
  const [officialPages, officialChunks] = source
    ? await Promise.all([
        prisma.knowledgeDocument.count({ where: { sourceId: source.id, documentStatus: 'ready' } }),
        prisma.knowledgeChunk.count({ where: { document: { sourceId: source.id }, isActive: true } }),
      ])
    : [0, 0];
  msDb += nowMs() - tDb0;

  const budgetSnapshot = computeDevWixBudgetSnapshot({ officialChunks });
  const degradedIngest = applyDevWixIngestDegradation(budgetSnapshot.budgetMode, {
    maxEmbeddings: requestedMaxEmbeddings,
    maxChunksPerPage: requestedMaxChunksPerPage,
    chunkTokens: requestedChunkTokens,
    overlapTokens: requestedOverlapTokens,
  });

  const maxEmbeddings = degradedIngest.maxEmbeddings;
  const maxChunksPerPage = degradedIngest.maxChunksPerPage;
  const chunkTokens = degradedIngest.chunkTokens;
  const overlapTokens = degradedIngest.overlapTokens;
  const deadline = nowMs() + maxDurationMs;

  const buildResult = (overrides: Partial<IngestResult> = {}): IngestResult => ({
    ok: true,
    jobId,
    startUrl,
    limitPages,
    fetched,
    stored,
    skippedUnchanged,
    chunksUpserted,
    discoveredQueued: 0,
    stoppedReason,
    budgetMode: budgetSnapshot.budgetMode,
    officialPages,
    officialChunks,
    embeddingPressureRatio: budgetSnapshot.embeddingPressureRatio,
    dbPressureRatio: budgetSnapshot.dbPressureRatio,
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
    budgetHit:
      stoppedReason === 'time_budget_exhausted' ||
      stoppedReason === 'embed_budget_exhausted' ||
      stoppedReason === 'budget_aggressive_stop',
    budgetHitType:
      stoppedReason === 'time_budget_exhausted'
        ? 'time'
        : stoppedReason === 'embed_budget_exhausted' || stoppedReason === 'budget_aggressive_stop'
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
    ...overrides,
  });

  if (!source) {
    return buildResult({
      stoppedReason: 'source_missing',
    });
  }

  const job = await createKnowledgeJob({
    sourceKey: DEV_WIX_SOURCE_KEY,
    jobKind: 'ingest',
    batchLimit: limitPages,
    cursor: startUrl,
  });
  jobId = job.id;

  await logDevWixInfo('dev_wix_ingest_started', {
    jobId,
    startUrl,
    limitPages,
    budgetMode: budgetSnapshot.budgetMode,
    embeddingPressureRatio: budgetSnapshot.embeddingPressureRatio,
    dbPressureRatio: budgetSnapshot.dbPressureRatio,
    maxEmbeddings,
    maxChunksPerPage,
    chunkTokens,
    overlapTokens,
  });

  try {
    if (budgetSnapshot.budgetMode === 'aggressive') {
      stoppedReason = 'budget_aggressive_stop';

      const aggressiveResult = buildResult();
      const currentJobId = jobId;
      if (currentJobId) {
        await finishKnowledgeJob(currentJobId, {
          status: 'done',
          processed: 0,
          inserted: 0,
          updated: 0,
          skipped: 0,
          errorCount: 0,
          lastError: null,
          cursor: startUrl,
        });
      }

      await logDevWixInfo('dev_wix_ingest_completed', {
        jobId,
        fetched: aggressiveResult.fetched,
        stored: aggressiveResult.stored,
        skippedUnchanged: aggressiveResult.skippedUnchanged,
        chunksUpserted: aggressiveResult.chunksUpserted,
        stoppedReason: aggressiveResult.stoppedReason ?? null,
        budgetMode: aggressiveResult.budgetMode,
        officialPages: aggressiveResult.officialPages,
        officialChunks: aggressiveResult.officialChunks,
        embeddingPressureRatio: aggressiveResult.embeddingPressureRatio,
        dbPressureRatio: aggressiveResult.dbPressureRatio,
        duration: nowMs() - runStartedAt,
      });

      return aggressiveResult;
    }

    const baseWhere = {
      sourceId: source.id,
      ...(targetCanonicalUrl ? { canonicalUrl: targetCanonicalUrl } : {}),
    };

    const resumeTargets = (await prisma.knowledgeDocument.findMany({
      where: {
        ...baseWhere,
        documentStatus: { in: ['embedded', 'extracted', 'fetched'] },
      },
      orderBy: [{ updatedAt: 'asc' }, { fetchedAt: 'asc' }, { createdAt: 'asc' }],
      take: limitPages,
    })) as MutableDoc[];

    const remainingSlots = Math.max(0, limitPages - resumeTargets.length);

    const freshTargets =
      remainingSlots > 0
        ? ((await prisma.knowledgeDocument.findMany({
            where: {
              ...baseWhere,
              documentStatus: {
                in: opts?.force ? ['pending', 'failed', 'ready'] : ['pending', 'failed'],
              },
            },
            orderBy: [{ fetchedAt: 'asc' }, { createdAt: 'asc' }],
            take: remainingSlots,
          })) as MutableDoc[])
        : [];

    const targets = [...resumeTargets, ...freshTargets];

    for (const doc of targets) {
      if (nowMs() > deadline) {
        stoppedReason = 'time_budget_exhausted';
        break;
      }

      const embedMsBeforeDoc = msEmbed;

      try {
        const fetchStartedAt = nowMs();
        const response = await fetch(doc.canonicalUrl, {
          headers: {
            'User-Agent': 'botcow_assistance/1.0 (+https://botcow-assistance.vercel.app)',
            Accept: 'text/html,application/xhtml+xml',
          },
        });
        const fetchDurationMs = nowMs() - fetchStartedAt;
        msFetch += fetchDurationMs;

        fetched += 1;
        if (!startFetched) {
          startFetched = true;
          startStatus = response.status;
        }

        await logDevWixInfo('dev_wix_document_fetch_completed', {
          jobId,
          canonicalUrl: doc.canonicalUrl,
          lastHttpStatus: response.status,
          httpStatusClass: httpStatusClass(response.status),
          fetchDurationMs,
        });

        if (isDefinitivelyGone(response.status)) {
          const started = nowMs();
          await prisma.knowledgeChunk.updateMany({
            where: { documentId: doc.id, isActive: true },
            data: { isActive: false },
          });
          await transitionDocument({
            jobId,
            doc,
            nextStatus: 'deleted',
            lastHttpStatus: response.status,
            data: {
              lastHttpStatus: response.status,
              lastError: `http_${response.status}`,
            },
          });
          msDb += nowMs() - started;
          continue;
        }

        if (!response.ok || !acceptableContentType(response.headers.get('content-type'))) {
          const started = nowMs();
          await transitionDocument({
            jobId,
            doc,
            nextStatus: 'failed',
            lastHttpStatus: response.status,
            data: {
              lastHttpStatus: response.status,
              lastError: !response.ok ? `http_${response.status}` : 'invalid_content_type',
            },
          });
          msDb += nowMs() - started;
          continue;
        }

        const statusBeforeFetch = doc.documentStatus;
        const contentHashBeforeFetch = doc.contentHash;
        const fetchedAt = new Date();

        const fetchedStartedAt = nowMs();
        await transitionDocument({
          jobId,
          doc,
          nextStatus: 'fetched',
          lastHttpStatus: response.status,
          data: {
            lastHttpStatus: response.status,
            fetchedAt,
            lastError: null,
          },
        });
        msDb += nowMs() - fetchedStartedAt;

        const htmlRaw = await response.text();
        if (!startHtmlBytes) startHtmlBytes = htmlRaw.length;
        const html = stripHeavyHtml(htmlRaw);

        const transformStartedAt = nowMs();
        const { title, markdown } = htmlToMarkdown(html);
        msTransform += nowMs() - transformStartedAt;

        if (!markdown.trim()) {
          const started = nowMs();
          await transitionDocument({
            jobId,
            doc,
            nextStatus: 'failed',
            lastHttpStatus: response.status,
            data: {
              lastHttpStatus: response.status,
              lastError: 'empty_markdown',
            },
          });
          msDb += nowMs() - started;
          continue;
        }

        const contentHash = hashText(markdown);

        await logDevWixInfo('dev_wix_document_hash_computed', {
          jobId,
          canonicalUrl: doc.canonicalUrl,
          normalizedContentHash: contentHash,
        });

        const extractedStartedAt = nowMs();
        await transitionDocument({
          jobId,
          doc,
          nextStatus: 'extracted',
          lastHttpStatus: response.status,
          data: {
            title,
            normalizedMarkdown: markdown,
            contentHash,
            lastHttpStatus: response.status,
            fetchedAt,
            lastError: null,
          },
        });
        doc.contentHash = contentHash;
        msDb += nowMs() - extractedStartedAt;

        if (contentHashBeforeFetch && contentHashBeforeFetch === contentHash && statusBeforeFetch === 'ready') {
          const started = nowMs();
          await transitionDocument({
            jobId,
            doc,
            nextStatus: 'ready',
            lastHttpStatus: response.status,
            data: {
              title,
              lastError: null,
            },
          });
          msDb += nowMs() - started;
          skippedUnchanged += 1;

          await logDevWixInfo('dev_wix_document_unchanged', {
            jobId,
            canonicalUrl: doc.canonicalUrl,
            normalizedContentHash: contentHash,
            lastHttpStatus: response.status,
            httpStatusClass: httpStatusClass(response.status),
            fetchDurationMs,
          });
          continue;
        }

        const chunkStartedAt = nowMs();
        const chunks = chunkTextByTokens(markdown, { chunkTokens, overlapTokens }).slice(0, maxChunksPerPage);
        msChunk += nowMs() - chunkStartedAt;
        const finalChunks = chunks.length
          ? chunks
          : [{ text: markdown.trim(), tokenCount: Math.max(1, Math.ceil(markdown.length / 4)) }];

        await logDevWixInfo('dev_wix_document_chunked', {
          jobId,
          canonicalUrl: doc.canonicalUrl,
          chunkCountProduced: finalChunks.length,
        });

        const rebuildStartedAt = nowMs();
        const existingActiveRows = await loadActiveChunkResumeRows(doc.id);
        const resumeExistingActiveChunks = canResumeActiveChunkSet(existingActiveRows, finalChunks);

        let chunkRows: Array<{ id: string; chunkText: string }>;

        if (resumeExistingActiveChunks) {
          chunkRows = existingActiveRows
            .filter((row) => !row.hasEmbedding)
            .map((row) => ({ id: row.id, chunkText: row.chunkText }));

          await logDevWixInfo('dev_wix_document_resume_detected', {
            jobId,
            canonicalUrl: doc.canonicalUrl,
            chunkVersion: existingActiveRows[0]?.chunkVersion ?? null,
            pendingChunkCount: chunkRows.length,
            totalChunkCount: existingActiveRows.length,
          });
        } else {
          const latestChunk = await prisma.knowledgeChunk.findFirst({
            where: { documentId: doc.id },
            orderBy: [{ chunkVersion: 'desc' }, { chunkIndex: 'desc' }],
            select: { chunkVersion: true },
          });
          const nextChunkVersion = (latestChunk?.chunkVersion ?? 0) + 1;

          await prisma.knowledgeChunk.updateMany({
            where: { documentId: doc.id, isActive: true },
            data: { isActive: false },
          });

          await prisma.knowledgeChunk.createMany({
            data: finalChunks.map((chunk, index) => ({
              documentId: doc.id,
              chunkVersion: nextChunkVersion,
              chunkIndex: index,
              isActive: true,
              chunkText: chunk.text,
              tokenCount: chunk.tokenCount,
              textHash: hashText(chunk.text),
            })),
          });

          chunkRows = await prisma.knowledgeChunk.findMany({
            where: { documentId: doc.id, chunkVersion: nextChunkVersion, isActive: true },
            orderBy: { chunkIndex: 'asc' },
            select: { id: true, chunkText: true },
          });
        }

        msDb += nowMs() - rebuildStartedAt;

        if (chunkRows.length === 0) {
          const started = nowMs();
          const embeddedAt = new Date();

          await transitionDocument({
            jobId,
            doc,
            nextStatus: 'embedded',
            lastHttpStatus: response.status,
            data: {
              embeddedAt,
              lastError: null,
            },
          });

          await transitionDocument({
            jobId,
            doc,
            nextStatus: 'ready',
            lastHttpStatus: response.status,
            data: {
              lastError: null,
            },
          });

          msDb += nowMs() - started;
          stored += 1;
          continue;
        }

        const updates: Array<{ id: string; vectorLiteral: string }> = [];

        for (const chunk of chunkRows) {
          if (nowMs() > deadline) {
            stoppedReason = 'time_budget_exhausted';
            break;
          }

          if (embeddingsAttempted >= maxEmbeddings) {
            stoppedReason = 'embed_budget_exhausted';
            break;
          }

          embeddingsAttempted += 1;

          try {
            const embedStartedAt = nowMs();
            const embedded = await embedText(chunk.chunkText);
            msEmbed += nowMs() - embedStartedAt;

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

        const embedDurationMs = msEmbed - embedMsBeforeDoc;

        await logDevWixInfo('dev_wix_document_embedded', {
          jobId,
          canonicalUrl: doc.canonicalUrl,
          embeddingCountProduced: updates.length,
          embedDurationMs,
        });

        if (updates.length > 0) {
          const started = nowMs();
          const sql = buildVectorUpdateSql({ updates });
          await prisma.$executeRawUnsafe(sql.sql, ...sql.values);
          msDb += nowMs() - started;
        }

        if (updates.length !== chunkRows.length) {
          const started = nowMs();

          if (
            (stoppedReason === 'embed_budget_exhausted' || stoppedReason === 'time_budget_exhausted') &&
            updates.length > 0
          ) {
            await transitionDocument({
              jobId,
              doc,
              nextStatus: 'embedded',
              lastHttpStatus: response.status,
              data: {
                embeddedAt: new Date(),
                lastError: null,
              },
            });
            msDb += nowMs() - started;
            break;
          }

          await transitionDocument({
            jobId,
            doc,
            nextStatus: 'failed',
            data: {
              lastError: lastEmbedError ?? stoppedReason ?? 'embedding_incomplete',
            },
          });
          msDb += nowMs() - started;

          if (stoppedReason === 'embed_budget_exhausted' || stoppedReason === 'time_budget_exhausted') break;
          continue;
        }

        {
          const started = nowMs();
          const embeddedAt = new Date();

          await transitionDocument({
            jobId,
            doc,
            nextStatus: 'embedded',
            lastHttpStatus: response.status,
            data: {
              embeddedAt,
              lastError: null,
            },
          });

          await transitionDocument({
            jobId,
            doc,
            nextStatus: 'ready',
            lastHttpStatus: response.status,
            data: {
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
        await transitionDocument({
          jobId,
          doc,
          nextStatus: 'failed',
          data: {
            lastError: error?.message ?? String(error),
          },
        }).catch(() => undefined);
        msDb += nowMs() - started;

        await logDevWixWarn('dev_wix_document_processing_failed', {
          jobId,
          canonicalUrl: doc.canonicalUrl,
          error: error?.message ?? String(error),
        });
      }
    }

    const result = buildResult();

    const currentJobId = jobId;
    if (currentJobId) {
      await finishKnowledgeJob(currentJobId, {
        status: 'done',
        processed: fetched,
        inserted: stored,
        updated: chunksUpserted,
        skipped: skippedUnchanged,
        errorCount: embedFailures,
        lastError: lastEmbedError ?? startFetchError ?? null,
        cursor: startUrl,
      });
    }

    await logDevWixInfo('dev_wix_ingest_completed', {
      jobId,
      fetched: result.fetched,
      stored: result.stored,
      skippedUnchanged: result.skippedUnchanged,
      chunksUpserted: result.chunksUpserted,
      stoppedReason: result.stoppedReason ?? null,
      budgetMode: result.budgetMode,
      officialPages: result.officialPages,
      officialChunks: result.officialChunks,
      embeddingPressureRatio: result.embeddingPressureRatio,
      dbPressureRatio: result.dbPressureRatio,
      duration: nowMs() - runStartedAt,
      msFetch: result.msFetch,
      msEmbed: result.msEmbed,
    });

    return result;
  } catch (error: any) {
    const currentJobId = jobId;
    if (currentJobId) {
      await finishKnowledgeJob(currentJobId, {
        status: 'failed',
        processed: fetched,
        inserted: stored,
        updated: chunksUpserted,
        skipped: skippedUnchanged,
        errorCount: Math.max(1, embedFailures),
        lastError: error?.message ?? String(error),
        cursor: startUrl,
      }).catch(() => undefined);
    }

    await logDevWixWarn('dev_wix_ingest_failed', {
      jobId,
      fetched,
      stored,
      skippedUnchanged,
      chunksUpserted,
      embedFailures,
      error: error?.message ?? String(error),
      duration: nowMs() - runStartedAt,
    });

    throw error;
  }
}
