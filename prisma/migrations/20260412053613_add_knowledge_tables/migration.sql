/*
  Warnings:

  - You are about to drop the column `blobPath` on the `DocPage` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "KnowledgeSourceStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "KnowledgeJobStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "KnowledgeDocumentStatus" AS ENUM ('PENDING', 'FETCHED', 'CHUNKED', 'EMBEDDED', 'FAILED', 'GONE');

-- DropIndex
DROP INDEX "DocChunk_embedding_hnsw_l2_idx";

-- AlterTable
ALTER TABLE "DocPage" DROP COLUMN "blobPath";

-- CreateTable
CREATE TABLE "knowledge_sources" (
    "id" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "source_kind" TEXT NOT NULL,
    "seed_manifest_path" TEXT NOT NULL,
    "scope_allowlist" TEXT NOT NULL,
    "status" "KnowledgeSourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_jobs" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "job_kind" TEXT NOT NULL,
    "job_status" "KnowledgeJobStatus" NOT NULL DEFAULT 'RUNNING',
    "batch_limit" INTEGER,
    "cursor" TEXT,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "inserted" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "original_url" TEXT NOT NULL,
    "canonical_url" TEXT NOT NULL,
    "source_section" TEXT,
    "title" TEXT,
    "normalized_markdown" TEXT,
    "content_hash" TEXT,
    "last_http_status" INTEGER,
    "document_status" "KnowledgeDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "fetched_at" TIMESTAMP(3),
    "embedded_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "chunk_text" TEXT NOT NULL,
    "token_count" INTEGER NOT NULL,
    "text_hash" TEXT NOT NULL,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_sources_source_key_key" ON "knowledge_sources"("source_key");

-- CreateIndex
CREATE INDEX "knowledge_jobs_source_id_job_kind_created_at_idx" ON "knowledge_jobs"("source_id", "job_kind", "created_at");

-- CreateIndex
CREATE INDEX "knowledge_jobs_job_status_idx" ON "knowledge_jobs"("job_status");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_documents_canonical_url_key" ON "knowledge_documents"("canonical_url");

-- CreateIndex
CREATE INDEX "knowledge_documents_source_id_document_status_idx" ON "knowledge_documents"("source_id", "document_status");

-- CreateIndex
CREATE INDEX "knowledge_documents_source_id_canonical_url_idx" ON "knowledge_documents"("source_id", "canonical_url");

-- CreateIndex
CREATE INDEX "knowledge_chunks_document_id_idx" ON "knowledge_chunks"("document_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_document_id_chunk_index_key" ON "knowledge_chunks"("document_id", "chunk_index");

-- AddForeignKey
ALTER TABLE "knowledge_jobs" ADD CONSTRAINT "knowledge_jobs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
