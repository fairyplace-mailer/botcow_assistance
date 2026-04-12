/*
  Warnings:

  - The values [PENDING,FETCHED,CHUNKED,EMBEDDED,FAILED,GONE] on the enum `KnowledgeDocumentStatus` will be removed. If these variants are still used in the database, this will fail.
  - The values [RUNNING,SUCCESS,FAILED] on the enum `KnowledgeJobStatus` will be removed. If these variants are still used in the database, this will fail.
  - The values [ACTIVE,DISABLED] on the enum `KnowledgeSourceStatus` will be removed. If these variants are still used in the database, this will fail.
  - A unique constraint covering the columns `[source_id,canonical_url]` on the table `knowledge_documents` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "KnowledgeDocumentStatus_new" AS ENUM ('pending', 'fetched', 'extracted', 'embedded', 'ready', 'failed', 'deleted');
ALTER TABLE "public"."knowledge_documents" ALTER COLUMN "document_status" DROP DEFAULT;
ALTER TABLE "knowledge_documents" ALTER COLUMN "document_status" TYPE "KnowledgeDocumentStatus_new" USING ("document_status"::text::"KnowledgeDocumentStatus_new");
ALTER TYPE "KnowledgeDocumentStatus" RENAME TO "KnowledgeDocumentStatus_old";
ALTER TYPE "KnowledgeDocumentStatus_new" RENAME TO "KnowledgeDocumentStatus";
DROP TYPE "public"."KnowledgeDocumentStatus_old";
ALTER TABLE "knowledge_documents" ALTER COLUMN "document_status" SET DEFAULT 'pending';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "KnowledgeJobStatus_new" AS ENUM ('queued', 'running', 'paused', 'done', 'failed');
ALTER TABLE "public"."knowledge_jobs" ALTER COLUMN "job_status" DROP DEFAULT;
ALTER TABLE "knowledge_jobs" ALTER COLUMN "job_status" TYPE "KnowledgeJobStatus_new" USING ("job_status"::text::"KnowledgeJobStatus_new");
ALTER TYPE "KnowledgeJobStatus" RENAME TO "KnowledgeJobStatus_old";
ALTER TYPE "KnowledgeJobStatus_new" RENAME TO "KnowledgeJobStatus";
DROP TYPE "public"."KnowledgeJobStatus_old";
ALTER TABLE "knowledge_jobs" ALTER COLUMN "job_status" SET DEFAULT 'queued';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "KnowledgeSourceStatus_new" AS ENUM ('active', 'disabled');
ALTER TABLE "public"."knowledge_sources" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "knowledge_sources" ALTER COLUMN "status" TYPE "KnowledgeSourceStatus_new" USING ("status"::text::"KnowledgeSourceStatus_new");
ALTER TYPE "KnowledgeSourceStatus" RENAME TO "KnowledgeSourceStatus_old";
ALTER TYPE "KnowledgeSourceStatus_new" RENAME TO "KnowledgeSourceStatus";
DROP TYPE "public"."KnowledgeSourceStatus_old";
ALTER TABLE "knowledge_sources" ALTER COLUMN "status" SET DEFAULT 'active';
COMMIT;

-- DropIndex
DROP INDEX "knowledge_documents_canonical_url_key";

-- DropIndex
DROP INDEX "knowledge_documents_source_id_canonical_url_idx";

-- AlterTable
ALTER TABLE "knowledge_documents" ALTER COLUMN "document_status" SET DEFAULT 'pending';

-- AlterTable
ALTER TABLE "knowledge_jobs" ALTER COLUMN "job_status" SET DEFAULT 'queued';

-- AlterTable
ALTER TABLE "knowledge_sources" ALTER COLUMN "status" SET DEFAULT 'active';

-- CreateIndex
CREATE INDEX "knowledge_documents_canonical_url_idx" ON "knowledge_documents"("canonical_url");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_documents_source_id_canonical_url_key" ON "knowledge_documents"("source_id", "canonical_url");
