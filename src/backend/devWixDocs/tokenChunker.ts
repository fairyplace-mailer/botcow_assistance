export type TokenChunkOpts = {
  chunkTokens?: number;
  overlapTokens?: number;
};

export type TokenChunk = {
  text: string;
  tokenCount: number;
};

const CHARS_PER_TOKEN = 4;

function clampInt(n: number, min: number, max: number): number {
  const x = Math.trunc(Number.isFinite(n) ? n : min);
  return Math.max(min, Math.min(max, x));
}

function approxTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

function splitMarkdownBlocks(markdown: string): string[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;

  const pushCurrent = () => {
    const text = current.join('\n').trim();
    if (text) blocks.push(text);
    current = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const fence = /^```/.test(trimmed);

    if (fence) {
      current.push(line);
      inFence = !inFence;
      if (!inFence) {
        pushCurrent();
      }
      continue;
    }

    if (inFence) {
      current.push(line);
      continue;
    }

    if (/^#{1,6}\s+/.test(trimmed)) {
      pushCurrent();
      current.push(line);
      continue;
    }

    if (!trimmed) {
      pushCurrent();
      continue;
    }

    current.push(line);
  }

  pushCurrent();
  return blocks;
}

function splitOversizedBlock(block: string, maxChars: number): string[] {
  if (block.length <= maxChars) return [block.trim()];

  const parts: string[] = [];
  let cursor = 0;
  while (cursor < block.length) {
    let end = Math.min(block.length, cursor + maxChars);
    if (end < block.length) {
      const newline = block.lastIndexOf('\n', end);
      const sentence = block.lastIndexOf('. ', end);
      const breakAt = Math.max(newline, sentence);
      if (breakAt > cursor + Math.floor(maxChars * 0.5)) {
        end = breakAt + (block[breakAt] === '\n' ? 0 : 1);
      }
    }
    const slice = block.slice(cursor, end).trim();
    if (slice) parts.push(slice);
    if (end === cursor) break;
    cursor = end;
  }

  return parts;
}

export function chunkTextByTokens(text: string, opts?: TokenChunkOpts): TokenChunk[] {
  const chunkTokens = clampInt(Number(opts?.chunkTokens ?? 800), 1, 2000);
  const targetChars = Math.max(1, chunkTokens * CHARS_PER_TOKEN);

  const markdown = text.trim();
  if (!markdown) return [];

  const blocks = splitMarkdownBlocks(markdown);
  const chunks: TokenChunk[] = [];
  let current = '';

  const flush = () => {
    const normalized = current.trim();
    if (!normalized) return;
    chunks.push({ text: normalized, tokenCount: approxTokens(normalized) });
    current = '';
  };

  for (const block of blocks) {
    const pieces = splitOversizedBlock(block, targetChars);
    for (const piece of pieces) {
      const candidate = current ? `${current}\n\n${piece}` : piece;
      if (candidate.length <= targetChars || !current) {
        current = candidate;
        continue;
      }
      flush();
      current = piece;
    }
  }

  flush();
  return chunks;
}
