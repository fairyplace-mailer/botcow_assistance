-- Enable pgvector extension (required for embeddings)
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "KvItem" (
    "key" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KvItem_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "DocPage" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "text" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "blobPath" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocChunk" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "content" TEXT NOT NULL,

    -- pgvector embedding
    "embedding" vector(1536),
    "embeddingModel" TEXT,
    "dims" INTEGER,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocPage_url_key" ON "DocPage"("url");

-- CreateIndex
CREATE INDEX "DocPage_fetchedAt_idx" ON "DocPage"("fetchedAt");

-- CreateIndex
CREATE INDEX "DocPage_lastSeenAt_idx" ON "DocPage"("lastSeenAt");

-- CreateIndex
CREATE INDEX "DocChunk_pageId_idx" ON "DocChunk"("pageId");

-- CreateIndex
CREATE UNIQUE INDEX "DocChunk_pageId_idx_key" ON "DocChunk"("pageId", "idx");

-- AddForeignKey
ALTER TABLE "DocChunk" ADD CONSTRAINT "DocChunk_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "DocPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
