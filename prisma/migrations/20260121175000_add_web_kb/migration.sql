-- External Web KB tables (curated crawl)

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "WebSite" (
  "id" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WebSite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WebSite_domain_key" ON "WebSite"("domain");

CREATE TABLE IF NOT EXISTS "WebPage" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "title" TEXT,
  "httpStatus" INTEGER,
  "excludedReason" TEXT,
  "contentHash" TEXT,
  "fetchedAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3),
  "refreshIntervalHours" INTEGER NOT NULL DEFAULT 480,
  "nextFetchAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WebPage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WebPage_url_key" ON "WebPage"("url");
CREATE INDEX IF NOT EXISTS "WebPage_siteId_nextFetchAt_idx" ON "WebPage"("siteId", "nextFetchAt");
CREATE INDEX IF NOT EXISTS "WebPage_fetchedAt_idx" ON "WebPage"("fetchedAt");
CREATE INDEX IF NOT EXISTS "WebPage_lastSeenAt_idx" ON "WebPage"("lastSeenAt");

ALTER TABLE "WebPage" ADD CONSTRAINT "WebPage_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "WebSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "WebChunk" (
  "id" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "idx" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "embedding" vector(3072),
  "embeddingModel" TEXT,
  "dims" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WebChunk_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WebChunk_pageId_idx_key" ON "WebChunk"("pageId", "idx");
CREATE INDEX IF NOT EXISTS "WebChunk_pageId_idx" ON "WebChunk"("pageId");

ALTER TABLE "WebChunk" ADD CONSTRAINT "WebChunk_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "WebPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
