import { prisma } from '../db';
import {
  createOrReuseKnowledgeJob,
  finishKnowledgeJob,
  markKnowledgeJobRunning,
} from '../knowledgeJobs';
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
  reusedJob: boolean;
  resumedFromCursor: number;
};

export async function bootstrapDevWixKnowledge(
  opts?: BootstrapDevWixKnowledgeOptions,
): Promise<BootstrapDevWixKnowledgeResult> {
  const batchLimit = Math.max(1, Math.min(500, Number(opts?.batchLimit ?? 100)));
  const requestedCursor =
    typeof opts?.cursor === 'number' && Number.isFinite(opts.cursor)
      ? Math.max(0, Number(opts.cursor))
      : undefined;

  const manifest = loadDevWixSeedManifest(opts?.repoRoot);

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

  const { job: jobRecord, reused } = await createOrReuseKnowledgeJob({
    sourceId: source.id,
    jobKind: 'bootstrap',
    batchLimit,
    ...(requestedCursor !== undefined ? { cursor: String(requestedCursor) } : {}),
  });

  const resumedFromCursor =
    requestedCursor ?? Math.max(0, Number(jobRecord.cursor ?? 0));

  const batch = manifest.urls.slice(resumedFromCursor, resumedFromCursor + batchLimit);
  const nextCursor =
    resumedFromCursor + batch.length < manifest.urls.length
      ? resumedFromCursor + batch.length
      : null;

  await markKnowledgeJobRunning(jobRecord.id);

  await logDevWixInfo('dev_wix_bootstrap_started', {
    jobId: jobRecord.id,
    manifestPath: manifest.manifestPath,
    totalInManifest: manifest.urls.length,
    rejectedCount: manifest.rejected.length,
    batchLimit,
    cursor: resumedFromCursor,
    reusedJob: reused,
    reusedFromStatus: reused ? (jobRecord.jobStatus ?? null) : 'queued',
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
          jobId: jobRecord.id,
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
        jobId: jobRecord.id,
        canonicalUrl: url,
        action: 'created_pending',
        documentStatusTo: 'pending',
      });
    }

    await finishKnowledgeJob(jobRecord.id, {
      status: 'done',
      processed: batch.length,
      inserted,
      updated,
      skipped,
      cursor: nextCursor === null ? null : String(nextCursor),
      lastError: null,
    });

    await logDevWixInfo('dev_wix_bootstrap_completed', {
      jobId: jobRecord.id,
      processed: batch.length,
      inserted,
      updated,
      skipped,
      nextCursor,
      reusedJob: reused,
      resumedFromCursor,
    });
  } catch (error: any) {
    await finishKnowledgeJob(jobRecord.id, {
      status: 'failed',
      processed: batch.length,
      inserted,
      updated,
      skipped,
      errorCount: 1,
      lastError: error?.message ?? String(error),
      cursor: String(resumedFromCursor),
    });

    await logDevWixWarn('dev_wix_bootstrap_failed', {
      jobId: jobRecord.id,
      processed: batch.length,
      inserted,
      updated,
      skipped,
      error: error?.message ?? String(error),
      reusedJob: reused,
      resumedFromCursor,
    });

    throw error;
  }

  return {
    sourceId: source.id,
    jobId: jobRecord.id,
    manifestPath: manifest.manifestPath,
    totalInManifest: manifest.urls.length,
    rejectedCount: manifest.rejected.length,
    processed: batch.length,
    inserted,
    updated,
    skipped,
    nextCursor,
    reusedJob: reused,
    resumedFromCursor,
  };
}
