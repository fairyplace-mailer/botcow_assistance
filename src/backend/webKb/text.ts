export function chunkTextByChars(
  text: string,
  opts: { chunkChars: number; overlapChars: number }
): string[] {
  const chunkChars = Math.max(200, opts.chunkChars);
  const overlapChars = Math.max(0, Math.min(opts.overlapChars, chunkChars - 50));

  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(text.length, i + chunkChars);
    const chunk = text.slice(i, end).trim();
    if (chunk.length > 0) chunks.push(chunk);
    if (end === text.length) break;
    i = Math.max(0, end - overlapChars);
  }
  return chunks;
}

export function chunkTextByTokens(
  text: string,
  opts?: { chunkTokens?: number; overlapTokens?: number }
): string[] {
  // Approximation: 1 token ~ 4 chars (English). Keeps us dependency-free.
  const chunkTokens = opts?.chunkTokens ?? 800;
  const overlapTokens = opts?.overlapTokens ?? 120;

  const chunkChars = chunkTokens * 4;
  const overlapChars = overlapTokens * 4;

  return chunkTextByChars(text, { chunkChars, overlapChars });
}
