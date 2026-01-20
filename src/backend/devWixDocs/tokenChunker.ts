export type TokenChunkOpts = {
  chunkTokens?: number;
  overlapTokens?: number;
};

export type TokenChunk = {
  text: string;
  tokenCount: number;
};

// Approximate tokenization for English:
// A commonly used heuristic is ~4 characters per token.
// This avoids WASM/tokenizer bundling issues in Next/Turbopack while keeping
// chunk sizes aligned with the spec (500–1000 tokens).
const CHARS_PER_TOKEN = 4;

function clampInt(n: number, min: number, max: number): number {
  const x = Math.trunc(Number.isFinite(n) ? n : min);
  return Math.max(min, Math.min(max, x));
}

/**
 * Chunk text into ~token-sized slices using a char-based approximation.
 *
 * Notes:
 * - Designed for EN text (dev.wix.com/docs). For other languages the heuristic
 *   may be off; those pages are ignored elsewhere.
 */
export function chunkTextByTokens(text: string, opts?: TokenChunkOpts): TokenChunk[] {
  const chunkTokens = clampInt(Number(opts?.chunkTokens ?? 800), 1, 2000);
  const overlapTokens = clampInt(Number(opts?.overlapTokens ?? 120), 0, chunkTokens - 1);

  const t = text.trim();
  if (!t) return [];

  const chunkChars = Math.max(1, chunkTokens * CHARS_PER_TOKEN);
  const overlapChars = overlapTokens * CHARS_PER_TOKEN;

  const chunks: TokenChunk[] = [];

  let i = 0;
  while (i < t.length) {
    const end = Math.min(t.length, i + chunkChars);
    const slice = t.slice(i, end).trim();
    if (slice) {
      const approxTokens = Math.max(1, Math.ceil(slice.length / CHARS_PER_TOKEN));
      chunks.push({ text: slice, tokenCount: approxTokens });
    }

    if (end === t.length) break;
    i = end - overlapChars;
    if (i < 0) i = 0;
  }

  return chunks;
}
