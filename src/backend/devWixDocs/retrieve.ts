import { prisma } from '../db';
import { embedText } from '../openai';

export type RetrievedDocChunk = {
  url: string;
  title: string | null;
  content: string;
  score: number;
};

type RetrievedRow = {
  id: string;
  pageId: string;
  url: string;
  title: string | null;
  content: string;
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

  const nowIso = new Date().toISOString();
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT c.id, c."pageId", p.url, p.title, c.content, (c.embedding <-> '${vectorLiteral(emb.vector)}'::vector) AS distance
     FROM "DocChunk" c
     JOIN "DocPage" p ON p.id = c."pageId"
     WHERE c.embedding IS NOT NULL
       AND (
         (c."knowledgeLayer" = 'OFFICIAL' AND p."knowledgeLayer" = 'OFFICIAL')
         OR (
           c."knowledgeLayer" = 'TEMPORARY'
           AND p."knowledgeLayer" = 'TEMPORARY'
           AND c."retentionUntil" IS NOT NULL
           AND p."retentionUntil" IS NOT NULL
           AND c."retentionUntil" > '${nowIso}'::timestamp
           AND p."retentionUntil" > '${nowIso}'::timestamp
         )
       )
     ORDER BY
       CASE WHEN p."knowledgeLayer" = 'OFFICIAL' THEN 0 ELSE 1 END ASC,
       c.embedding <-> '${vectorLiteral(emb.vector)}'::vector
     LIMIT ${Math.max(1, Math.min(20, topK * 3))};`,
  )) as RetrievedRow[];

  const scored = rows.map((r) => ({
    id: r.id,
    pageId: r.pageId,
    url: r.url,
    title: r.title,
    content: r.content,
    score: 1 / (1 + (r.distance ?? 0)),
  }));

  const out: RetrievedDocChunk[] = [];
  const usedChunkIds: string[] = [];
  const usedPageIds = new Set<string>();
  let used = 0;
  for (const s of scored) {
    const snippet = s.content.trim();
    if (!snippet) continue;
    if (used + snippet.length > maxChars) break;
    out.push({ url: s.url, title: s.title, content: s.content, score: s.score });
    usedChunkIds.push(s.id);
    usedPageIds.add(s.pageId);
    used += snippet.length;
    if (out.length >= topK) break;
  }

  if (usedChunkIds.length > 0) {
    const now = new Date();
    await prisma.$transaction([
      prisma.docChunk.updateMany({ where: { id: { in: usedChunkIds } }, data: { lastAccessedAt: now } }),
      prisma.docPage.updateMany({ where: { id: { in: Array.from(usedPageIds) } }, data: { lastAccessedAt: now } }),
    ]);
  }

  return { chunks: out, queryEmbeddingDims: emb.dims };
}

export function formatDevWixContext(chunks: RetrievedDocChunk[]): string {
  if (!chunks.length) return '';

  const lines: string[] = [];
  lines.push('Wix developer docs context (dev.wix.com/docs):');
  for (const c of chunks) {
    const title = c.title ? ` \u0015 \u0015 ${c.title}` : '';
    lines.push(`- Source: ${c.url}${title}`);
    lines.push(c.content.trim());
    lines.push('');
  }
  return lines.join('\n');
}
