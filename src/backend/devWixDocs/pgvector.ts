import type { PrismaClient } from "@prisma/client";

function safeNumberString(n: number): string {
  if (!Number.isFinite(n)) throw new Error("embedding contains non-finite number");
  const s = String(n);
  if (s.includes("Infinity") || s.includes("NaN")) {
    throw new Error("embedding contains invalid number");
  }
  return s;
}

export function embeddingToSqlVectorLiteral(embedding: number[]): string {
  // pgvector accepts: '[1,2,3]'::vector
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("embeddingToSqlVectorLiteral: embedding[] required");
  }

  const body = embedding.map(safeNumberString).join(",");
  return `'[${body}]'::vector`;
}

export async function updateDocChunkVector(params: {
  prisma: PrismaClient;
  chunkId: string;
  embedding: number[];
  embeddingModel: string;
}): Promise<void> {
  const vectorSql = embeddingToSqlVectorLiteral(params.embedding);

  await params.prisma.$executeRawUnsafe(
    `UPDATE "DocChunk" SET "embedding" = ${vectorSql}, "embeddingModel" = $1, "dims" = $2 WHERE "id" = $3`,
    params.embeddingModel,
    params.embedding.length,
    params.chunkId,
  );
}
