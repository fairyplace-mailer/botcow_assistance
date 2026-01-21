-- Manual migration (prepared for prisma migrate deploy)

-- 1) CronLock table (DB-backed daily lock for cron jobs)
CREATE TABLE IF NOT EXISTS "CronLock" (
  "name" TEXT NOT NULL,
  "lockedAt" TIMESTAMP(3) NOT NULL,
  "lockedUntil" TIMESTAMP(3) NOT NULL,
  "metaJson" JSONB,

  CONSTRAINT "CronLock_pkey" PRIMARY KEY ("name")
);

-- 2) DocPage scheduling + bookkeeping
ALTER TABLE "DocPage"
  ADD COLUMN IF NOT EXISTS "httpStatus" INTEGER,
  ADD COLUMN IF NOT EXISTS "refreshIntervalHours" INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS "nextFetchAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "DocPage_nextFetchAt_idx" ON "DocPage"("nextFetchAt");
