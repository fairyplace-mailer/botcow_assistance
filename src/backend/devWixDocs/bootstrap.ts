import { prisma } from '../db';
import { logDevWixInfo, logDevWixWarn } from './observability';
import {
  DEV_WIX_SCOPE_ALLOWLIST,
  DEV_WIX_SEED_MANIFEST_PATH,
  DEV_WIX_SOURCE_KEY,
  DEV_WIX_SOURCE_KIND,
  loadDevWixSeedManifest,
} from './seedManifest';

export type BootstrapDevWixKnowledgeOptions = {
  batchLimit?: number;
  repoRoot?: string;
  cursor?: number;
};

export type BootstrapDevWixKnowledgeResult = {
  sourceId: string;
  jobId: string;
  manifestPath: string;
  totalInManifest: number;
  rejectedCount: number;
  processed: number;
  inserted: number;
  updated: number;
  skipped: number;
  nextCursor: number | null;
};

export async function bootstrapDevWixKnowledge(
  opts?: BootstrapDevWixKnowledgeOptions,
): Promise<BootstrapDevWixKnowledgeResult> {
  const batchLimit = Math.max(1, Math.min(500, Number(opts?.batchLimit ?? 100)));
  const cursor = Math.max(0, Number(opts?.cursor ?? 0));
  const manifest = loadDevWixSeedManifest(opts?.repoRoot);
  const batch = manifest.urls.slice(cursor, cursor + batchLimit);
  const nextCursor = cursor + batch.length < manifest.urls.length ? cursor + batch.length : null;

  const source = await prisma.knowledgeSource.upsert({
    where: { sourceKey: DEV_WIX_SOURCE_KEY },
    update: {
      sourceKind: DEV_WIX_SOURCE_KIND,
      seedManifestPath: DEV_WIX_SEED_MANIFEST_PATH,
      scopeAllowlist: DEV_WIX_SCOPE_ALLOWLIST,
      status: 'active',
    },
    create: {
      sourceKey: DEV_WIX_SOURCE_KEY,
      sourceKind: DEV_WIX_SOURCE_KIND,
      seedManifestPath: DEV_WIX_SEED_MANIFEST_PATH,
      scopeAllowlist: DEV_WIX_SCOPE_ALLOWLIST,
      status: 'active',
    },
  });

  const job = await prisma.knowledgeJob.create({
    data: {
      sourceId: source.id,
      jobKind: 'bootstrap',
      jobStatus: 'running',
      batchLimit,
      cursor: String(cursor),
    },
  });

  await logDevWixInfo('dev_wix_bootstrap_started', {
    jobId: job.id,
    manifestPath: manifest.manifestPath,
    totalInManifest: manifest.urls.length,
    rejectedCount: manifest.rejected.length,
    batchLimit,
    cursor,
  });

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  try {
    for (const url of batch) {
      const existing = await prisma.knowledgeDocument.findFirst({
        where: { sourceId: source.id, canonicalUrl: url },
        select: { id: true, documentStatus: true },
      });

      if (existing) {
        await prisma.knowledgeDocument.update({
          where: { id: existing.id },
          data: {
            sourceId: source.id,
            originalUrl: url,
            lastError: null,
          },
        });
        updated += 1;

        await logDevWixInfo('dev_wix_bootstrap_document_registered', {
          jobId: job.id,
          canonicalUrl: url,
          action: 'updated_existing',
          documentStatusTo: existing.documentStatus ?? null,
        });
        continue;
      }

      await prisma.knowledgeDocument.create({
        data: {
          sourceId: source.id,
          originalUrl: url,
          canonicalUrl: url,
          sourceSection: DEV_WIX_SOURCE_KEY,
          documentStatus: 'pending',
        },
      });
      inserted += 1;

      await logDevWixInfo('dev_wix_bootstrap_document_registered', {
        jobId: job.id,
        canonicalUrl: url,
        action: 'created_pending',
        documentStatusTo: 'pending',
      });
    }

    await prisma.knowledgeJob.update({
      where: { id: job.id },
      data: {
        jobStatus: 'done',
        processed: batch.length,
        inserted,
        updated,
        skipped,
        cursor: nextCursor === null ? null : String(nextCursor),
        finishedAt: new Date(),
      },
    });

    await logDevWixInfo('dev_wix_bootstrap_completed', {
      jobId: job.id,
      processed: batch.length,
      inserted,
      updated,
      skipped,
      nextCursor,
    });
  } catch (error: any) {
    await prisma.knowledgeJob.update({
      where: { id: job.id },
      data: {
        jobStatus: 'failed',
        processed: batch.length,
        inserted,
        updated,
        skipped,
        errorCount: 1,
        lastError: error?.message ?? String(error),
        cursor: String(cursor),
        finishedAt: new Date(),
      },
    });

    await logDevWixWarn('dev_wix_bootstrap_failed', {
      jobId: job.id,
      processed: batch.length,
      inserted,
      updated,
      skipped,
      error: error?.message ?? String(error),
    });

    throw error;
  }

  return {
    sourceId: source.id,
    jobId: job.id,
    manifestPath: manifest.manifestPath,
    totalInManifest: manifest.urls.length,
    rejectedCount: manifest.rejected.length,
    processed: batch.length,
    inserted,
    updated,
    skipped,
    nextCursor,
  };
}
