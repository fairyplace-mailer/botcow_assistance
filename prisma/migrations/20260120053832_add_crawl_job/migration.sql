-- CreateTable
CREATE TABLE "CrawlJob" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "batchLimit" INTEGER,
    "processed" INTEGER,
    "inserted" INTEGER,
    "updated" INTEGER,
    "deleted" INTEGER,
    "skipped" INTEGER,
    "errorsJson" JSONB,
    "metaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrawlJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrawlJob_kind_startedAt_idx" ON "CrawlJob"("kind", "startedAt");

-- CreateIndex
CREATE INDEX "CrawlJob_status_idx" ON "CrawlJob"("status");
