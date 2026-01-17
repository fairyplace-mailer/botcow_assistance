import { prisma } from '../db';
import { embedText } from '../openai';

export type RetrievedDocChunk = {
  url: string;
  title: string | null;
  content: string;
  score: number;
};

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Retrieve most relevant chunks from stored dev.wix.com/docs pages.
 *
 * Note: This is a simple implementation: we load a bounded candidate set from DB
 * and score it in JS. If it becomes slow at scale, we can switch to pgvector.
 */
export async function retrieveDevWixContext(opts: {
  query: string;
  topK?: number;
  maxChars?: number;
  candidateLimit?: number;
}): Promise<{ chunks: RetrievedDocChunk[]; queryEmbeddingDims: number }> {
  const topK = opts.topK ?? 6;
  const maxChars = opts.maxChars ?? 6000;
  const candidateLimit = opts.candidateLimit ?? 800;

  const emb = await embedText(opts.query);

  // Pull recent-ish chunks to limit cost.
  // Prisma Json fields have tricky null semantics (JsonNull/DbNull). To avoid
  // build-time type issues, fetch candidates and filter in JS.
  const rows = await prisma.docChunk.findMany({
    orderBy: { createdAt: 'desc' },
    take: candidateLimit,
    include: { page: true },
  });

  const scored: RetrievedDocChunk[] = [];
  for (const r of rows) {
    const vec = r.embeddingJson as unknown as number[] | null;
    if (!Array.isArray(vec) || vec.length === 0) continue;
    const score = cosineSimilarity(emb.vector, vec);
    if (score <= 0) continue;
    scored.push({
      url: r.page.url,
      title: r.page.title ?? null,
      content: r.content,
      score,
    });
  }

  scored.sort((a, b) => b.score - a.score);

  const out: RetrievedDocChunk[] = [];
  let used = 0;
  for (const s of scored.slice(0, topK * 3)) {
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
    const title = c.title ? ` — ${c.title}` : '';
    lines.push(`- Source: ${c.url}${title}`);
    lines.push(c.content.trim());
    lines.push('');
  }
  return lines.join('\n');
}
