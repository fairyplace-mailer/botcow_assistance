-- Add pgvector embedding column to DocChunk for L2 retrieval.
-- Note: extension `vector` is already installed in our DB, but keep this idempotent.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "DocChunk"
  ADD COLUMN IF NOT EXISTS "embedding" vector(3072);

-- L2 distance operator is `<->`, so we use `vector_l2_ops`.
-- ivfflat has a 2000 dimension limit; our embeddings are 3072 dims (text-embedding-3-large).
-- Use hnsw index instead (supported by pgvector 0.8.0).
CREATE INDEX IF NOT EXISTS "DocChunk_embedding_hnsw_l2_idx"
  ON "DocChunk" USING hnsw ("embedding" vector_l2_ops)
  WITH (m = 16, ef_construction = 64);
