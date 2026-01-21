-- Add pgvector embedding column to DocChunk for L2 retrieval.
-- Note: extension `vector` is already installed in our DB, but keep this idempotent.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "DocChunk"
  ADD COLUMN IF NOT EXISTS "embedding" vector(3072);

-- L2 distance operator is `<->`, so we use `vector_l2_ops`.
-- We intentionally use ivfflat (supported by pgvector 0.8.0).
-- Lists tuned conservatively for ~200 pages; can be adjusted later.
CREATE INDEX IF NOT EXISTS "DocChunk_embedding_ivfflat_l2_idx"
  ON "DocChunk" USING ivfflat ("embedding" vector_l2_ops) WITH (lists = 100);
