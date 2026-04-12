import { prisma } from '../db';
import { embedText } from '../openai';
import { applyDevWixRetrievalDegradation, computeDevWixBudgetSnapshot } from './budgetPolicy';
import { logDevWixInfo, logDevWixWarn } from './observability';
import { DEV_WIX_SOURCE_KEY } from './seedManifest';

export type RetrievedDocChunk = {
  url: string;
  title: string | null;
  content: string;
  score: number;
};

type RetrievedRow = {
  id: string;
  documentId: string;
  canonicalUrl: string;
  title: string | null;
  chunkText: string;
  distance: number;
};

function vectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

export async function retrieveDevWixContext(opts: {
  query: string;
  topK?: number;
  maxChars?: number;
}): Promise<{
  chunks: RetrievedDocChunk[];
  queryEmbeddingDims: number;
  budgetMode: 'normal' | 'warning' | 'aggressive';
  embeddingPressureRatio: number;
  dbPressureRatio: number;
  effectiveTopK: number;
  effectiveMaxChars: number;
}> {
  const startedAt = Date.now();
  const requestedTopK = opts.topK ?? 6;
  const requestedMaxChars = opts.maxChars ?? 6000;

  try {
    const emb = await embedText(opts.query);
    if (!emb.vector.length) {
      const emptyResult = {
        chunks: [],
        queryEmbeddingDims: emb.dims,
        budgetMode: 'normal' as const,
        embeddingPressureRatio: 0,
        dbPressureRatio: 0,
        effectiveTopK: requestedTopK,
        effectiveMaxChars: requestedMaxChars,
      };

      await logDevWixInfo('dev_wix_retrieval_completed', {
        retrievalHitCount: 0,
        retrievalSourceCount: 0,
        queryEmbeddingDims: emb.dims,
        budgetMode: emptyResult.budgetMode,
        embeddingPressureRatio: emptyResult.embeddingPressureRatio,
        dbPressureRatio: emptyResult.dbPressureRatio,
        effectiveTopK: emptyResult.effectiveTopK,
        effectiveMaxChars: emptyResult.effectiveMaxChars,
        duration: Date.now() - startedAt,
      });

      return emptyResult;
    }

    const budgetRows = (await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count
       FROM knowledge_chunks c
       JOIN knowledge_documents d ON d.id = c.document_id
       JOIN knowledge_sources s ON s.id = d.source_id
       WHERE s.source_key = '${DEV_WIX_SOURCE_KEY}'
         AND s.status = 'active'
         AND d.document_status = 'ready';`,
    )) as Array<{ count: number | string }>;

    const officialChunks = Number(budgetRows[0]?.count ?? 0);
    const budgetSnapshot = computeDevWixBudgetSnapshot({ officialChunks });
    const degraded = applyDevWixRetrievalDegradation(budgetSnapshot.budgetMode, {
      topK: requestedTopK,
      maxChars: requestedMaxChars,
      probeLimit: Math.max(1, Math.min(20, requestedTopK * 3)),
    });

    const rows = (await prisma.$queryRawUnsafe(
      `SELECT c.id,
              c.document_id AS "documentId",
              d.canonical_url AS "canonicalUrl",
              d.title,
              c.chunk_text AS "chunkText",
              (c.embedding <-> '${vectorLiteral(emb.vector)}'::vector) AS distance
       FROM knowledge_chunks c
       JOIN knowledge_documents d ON d.id = c.document_id
       JOIN knowledge_sources s ON s.id = d.source_id
       WHERE c.embedding IS NOT NULL
         AND s.source_key = '${DEV_WIX_SOURCE_KEY}'
         AND s.status = 'active'
         AND d.document_status = 'ready'
       ORDER BY c.embedding <-> '${vectorLiteral(emb.vector)}'::vector
       LIMIT ${degraded.probeLimit};`,
    )) as RetrievedRow[];

    const scored = rows.map((r) => ({
      id: r.id,
      documentId: r.documentId,
      url: r.canonicalUrl,
      title: r.title,
      content: r.chunkText,
      score: 1 / (1 + (r.distance ?? 0)),
    }));

    const out: RetrievedDocChunk[] = [];
    let used = 0;

    for (const s of scored) {
      const snippet = s.content.trim();
      if (!snippet) continue;
      if (used + snippet.length > degraded.maxChars) break;

      out.push({
        url: s.url,
        title: s.title,
        content: s.content,
        score: s.score,
      });
      used += snippet.length;

      if (out.length >= degraded.topK) break;
    }

    const retrievalSourceCount = new Set(out.map((x) => x.url)).size;

    const result = {
      chunks: out,
      queryEmbeddingDims: emb.dims,
      budgetMode: budgetSnapshot.budgetMode,
      embeddingPressureRatio: budgetSnapshot.embeddingPressureRatio,
      dbPressureRatio: budgetSnapshot.dbPressureRatio,
      effectiveTopK: degraded.topK,
      effectiveMaxChars: degraded.maxChars,
    };

    await logDevWixInfo('dev_wix_retrieval_completed', {
      retrievalHitCount: out.length,
      retrievalSourceCount,
      queryEmbeddingDims: emb.dims,
      budgetMode: result.budgetMode,
      embeddingPressureRatio: result.embeddingPressureRatio,
      dbPressureRatio: result.dbPressureRatio,
      effectiveTopK: result.effectiveTopK,
      effectiveMaxChars: result.effectiveMaxChars,
      duration: Date.now() - startedAt,
    });

    return result;
  } catch (error: any) {
    await logDevWixWarn('dev_wix_retrieval_failed', {
      error: error?.message ?? String(error),
      duration: Date.now() - startedAt,
    });
    throw error;
  }
}

export function formatDevWixContext(chunks: RetrievedDocChunk[]): string {
  if (!chunks.length) return '';

  const lines: string[] = [];
  lines.push('Wix developer docs context (dev.wix.com/docs):');
  for (const c of chunks) {
    const title = c.title ? ` | ${c.title}` : '';
    lines.push(`- Source: ${c.url}${title}`);
    lines.push(c.content.trim());
    lines.push('');
  }
  return lines.join('\n');
}
