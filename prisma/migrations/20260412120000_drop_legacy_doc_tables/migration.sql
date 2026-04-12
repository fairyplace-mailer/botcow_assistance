DROP TABLE IF EXISTS "DocChunk";
DROP TABLE IF EXISTS "DocPage";
DROP TABLE IF EXISTS "CrawlJob";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'KnowledgeLayer') THEN
    DROP TYPE "KnowledgeLayer";
  END IF;
END $$;
