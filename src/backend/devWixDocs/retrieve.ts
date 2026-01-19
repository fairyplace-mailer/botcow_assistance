import { prisma } from '../db';
import { embedText } from '../openai';

export type RetrievedDocChunk = {
  url: string;
  title: string | null;
  content: string;
  score: number;
};

type RetrievedRow = {
  url: string;
  title: string | null;
  content: string;
  distance: number;
};

function vectorLiteral(vec: number[]): string {
  // pgvector accepts: '[1,2,3]'::vector
  return `[${vec.join(',')}]`;
}

/**
 * Retrieve most relevant chunks from stored dev.wix.com/docs pages.
 *
 * Uses pgvector for similarity search.
 */
export async function retrieveDevWixContext(opts: {
  query: string;
  topK?: number;
  maxChars?: number;
}): Promise<{ chunks: RetrievedDocChunk[]; queryEmbeddingDims: number }> {
  const topK = opts.topK ?? 6;
  const maxChars = opts.maxChars ?? 6000;

  const emb = await embedText(opts.query);
  if (!emb.vector.length) return { chunks: [], queryEmbeddingDims: emb.dims };

  // NOTE: We use $queryRawUnsafe because Prisma can't parameterize a pgvector literal
  // in a typed-safe way without custom extensions. Input comes from OpenAI vector,
  // not user-controlled string.
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT p.url, p.title, c.content, (c.embedding <-> '${vectorLiteral(emb.vector)}'::vector) AS distance
     FROM "DocChunk" c
     JOIN "DocPage" p ON p.id = c."pageId"
     WHERE c.embedding IS NOT NULL
     ORDER BY c.embedding <-> '${vectorLiteral(emb.vector)}'::vector
     LIMIT ${Math.max(1, Math.min(20, topK * 3))};`,
  )) as RetrievedRow[];

  // Convert distance to a descending score-like value.
  // L2 distance: smaller is better. We map to score in (0, 1].
  const scored = rows.map((r) => ({
    url: r.url,
    title: r.title,
    content: r.content,
    score: 1 / (1 + (r.distance ?? 0)),
  }));

  const out: RetrievedDocChunk[] = [];
  let used = 0;
  for (const s of scored) {
    const snippet = s.content.trim();
    if (!snippet) continue;
    if (used + snippet.length > maxChars) break;
    out.push(s);
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
    const title = c.title ? `   ${c.title}` : '';
    lines.push(`- Source: ${c.url}${title}`);
    lines.push(c.content.trim());
    lines.push('');
  }
  return lines.join('\n');
}
