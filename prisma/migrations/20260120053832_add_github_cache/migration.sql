-- CreateTable
CREATE TABLE "GithubCache" (
    "key" TEXT NOT NULL,
    "responseJson" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GithubCache_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "GithubCache_expiresAt_idx" ON "GithubCache"("expiresAt");
