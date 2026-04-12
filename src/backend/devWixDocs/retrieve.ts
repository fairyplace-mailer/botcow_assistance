import { prisma } from '../db';
import { embedText } from '../openai';
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
}): Promise<{ chunks: RetrievedDocChunk[]; queryEmbeddingDims: number }> {
  const topK = opts.topK ?? 6;
  const maxChars = opts.maxChars ?? 6000;

  const emb = await embedText(opts.query);
  if (!emb.vector.length) return { chunks: [], queryEmbeddingDims: emb.dims };

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
     LIMIT ${Math.max(1, Math.min(20, topK * 3))};`,
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
    if (used + snippet.length > maxChars) break;
    out.push({ url: s.url, title: s.title, content: s.content, score: s.score });
    used += snippet.length;
    if (out.length >= topK) break;
  }

  return { chunks: out, queryEmbeddingDims: emb.dims };
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
