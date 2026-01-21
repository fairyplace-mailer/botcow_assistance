import type { Prisma, PrismaClient } from "@prisma/client";

function embeddingToSqlVectorLiteral(embedding: number[]): string {
  // pgvector accepts string literal like '[1,2,3]'::vector
  const body = embedding.map((n) => (Number.isFinite(n) ? String(n) : "0")).join(",");
  return `'[${body}]'::vector`;
}

export async function updateWebChunkVector(params: {
  prisma: PrismaClient;
  chunkId: string;
  embedding: number[];
  embeddingModel: string;
}) {
  const literal = embeddingToSqlVectorLiteral(params.embedding);

  // NOTE: This requires WebChunk.embedding column added via migration.
  await params.prisma.$executeRawUnsafe(
    `UPDATE "WebChunk" SET "embedding" = ${literal}, "embeddingModel" = $1 WHERE "id" = $2`,
    params.embeddingModel,
    params.chunkId,
  );
}
