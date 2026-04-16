ALTER TABLE "knowledge_chunks"
ADD COLUMN "chunk_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT TRUE;

DROP INDEX IF EXISTS "knowledge_chunks_document_id_chunk_index_key";

CREATE INDEX "knowledge_chunks_document_id_is_active_idx"
ON "knowledge_chunks"("document_id", "is_active");

CREATE UNIQUE INDEX "knowledge_chunks_document_id_chunk_version_chunk_index_key"
ON "knowledge_chunks"("document_id", "chunk_version", "chunk_index");

CREATE UNIQUE INDEX "knowledge_chunks_active_document_id_chunk_index_key"
ON "knowledge_chunks"("document_id", "chunk_index")
WHERE "is_active" = TRUE;
