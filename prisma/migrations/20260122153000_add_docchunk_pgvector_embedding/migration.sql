-- Add pgvector embedding column to DocChunk for L2 retrieval.
-- Note: extension `vector` is already installed in our DB, but keep this idempotent.

CREATE EXTENSION IF NOT EXISTS vector;

-- NOTE: pgvector index methods (ivfflat/hnsw) have a 2000 dimension limit.
-- We use OpenAI text-embedding-3-small (1536 dims) to be able to index.
ALTER TABLE "DocChunk"
  ADD COLUMN IF NOT EXISTS "embedding" vector(1536);

-- L2 distance operator is `<->`, so we use `vector_l2_ops`.
CREATE INDEX IF NOT EXISTS "DocChunk_embedding_hnsw_l2_idx"
  ON "DocChunk" USING hnsw ("embedding" vector_l2_ops)
  WITH (m = 16, ef_construction = 64);
