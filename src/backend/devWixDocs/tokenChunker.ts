import { get_encoding } from 'tiktoken';

export type TokenChunkOpts = {
  chunkTokens?: number;
  overlapTokens?: number;
};

export type TokenChunk = {
  text: string;
  tokenCount: number;
};

export function chunkTextByTokens(text: string, opts?: TokenChunkOpts): TokenChunk[] {
  const chunkTokens = Math.max(1, Math.min(2000, Number(opts?.chunkTokens ?? 800)));
  const overlapTokens = Math.max(0, Math.min(chunkTokens - 1, Number(opts?.overlapTokens ?? 120)));

  const t = text.trim();
  if (!t) return [];

  // cl100k_base is the encoding used by modern OpenAI models.
  const enc = get_encoding('cl100k_base');
  try {
    const tokens = enc.encode(t);
    const chunks: TokenChunk[] = [];

    let i = 0;
    while (i < tokens.length) {
      const end = Math.min(tokens.length, i + chunkTokens);
      const slice = tokens.slice(i, end);

      // In tiktoken versions used in Node, decode() returns bytes (Uint8Array), not a string.
      const decodedBytes = enc.decode(slice);
      const decoded = new TextDecoder().decode(decodedBytes).trim();

      if (decoded) chunks.push({ text: decoded, tokenCount: slice.length });

      if (end === tokens.length) break;
      i = end - overlapTokens;
      if (i < 0) i = 0;
    }

    return chunks;
  } finally {
    // Prevent memory leak in serverless runtimes
    enc.free();
  }
}
