-- Add lastSeenAt for DocPage discovery seeding and staleness tracking
ALTER TABLE "DocPage" ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT now();

-- Helpful for maintenance / staleness reports
CREATE INDEX IF NOT EXISTS "DocPage_lastSeenAt_idx" ON "DocPage"("lastSeenAt");
