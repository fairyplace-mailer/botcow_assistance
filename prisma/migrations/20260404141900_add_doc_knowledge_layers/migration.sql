-- CreateEnum
CREATE TYPE "KnowledgeLayer" AS ENUM ('OFFICIAL', 'TEMPORARY');

-- AlterTable
ALTER TABLE "DocPage"
  ADD COLUMN "knowledgeLayer" "KnowledgeLayer" NOT NULL DEFAULT 'OFFICIAL',
  ADD COLUMN "retentionUntil" TIMESTAMP(3),
  ADD COLUMN "lastAccessedAt" TIMESTAMP(3),
  ADD COLUMN "retentionReason" TEXT;

ALTER TABLE "DocChunk"
  ADD COLUMN "knowledgeLayer" "KnowledgeLayer" NOT NULL DEFAULT 'OFFICIAL',
  ADD COLUMN "retentionUntil" TIMESTAMP(3),
  ADD COLUMN "lastAccessedAt" TIMESTAMP(3);

-- Backfill exact temporary seed placeholders only.
UPDATE "DocPage"
SET
  "knowledgeLayer" = 'TEMPORARY',
  "retentionUntil" = NOW() + INTERVAL '7 days',
  "retentionReason" = 'seed_placeholder'
WHERE "contentHash" = 'seed'
  AND COALESCE("text", '') = '';

UPDATE "DocChunk" c
SET
  "knowledgeLayer" = p."knowledgeLayer",
  "retentionUntil" = p."retentionUntil"
FROM "DocPage" p
WHERE c."pageId" = p."id";

-- Indexes
CREATE INDEX "DocPage_knowledgeLayer_retentionUntil_idx" ON "DocPage"("knowledgeLayer", "retentionUntil");
CREATE INDEX "DocChunk_knowledgeLayer_retentionUntil_idx" ON "DocChunk"("knowledgeLayer", "retentionUntil");
