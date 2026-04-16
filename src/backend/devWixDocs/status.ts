import { prisma } from '../db';
import { DEV_WIX_SOURCE_KEY } from './seedManifest';

type DocumentStatusCounts = {
  pending: number;
  fetched: number;
  extracted: number;
  embedded: number;
  ready: number;
  failed: number;
  deleted: number;
};

function emptyCounts(): DocumentStatusCounts {
  return {
    pending: 0,
    fetched: 0,
    extracted: 0,
    embedded: 0,
    ready: 0,
    failed: 0,
    deleted: 0,
  };
}

export async function getDevWixStatusSummary() {
  const source = await prisma.knowledgeSource.findUnique({
    where: { sourceKey: DEV_WIX_SOURCE_KEY },
    select: {
      id: true,
      sourceKey: true,
      sourceKind: true,
      status: true,
      seedManifestPath: true,
      scopeAllowlist: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!source) {
    return {
      source: null,
      jobs: [],
      counts: emptyCounts(),
      activeChunks: 0,
      workRemaining: 0,
    };
  }

  const [jobs, groupedCounts, activeChunks] = await Promise.all([
    prisma.knowledgeJob.findMany({
      where: { sourceId: source.id },
      orderBy: [{ createdAt: 'desc' }],
      take: 10,
      select: {
        id: true,
        jobKind: true,
        jobStatus: true,
        batchLimit: true,
        cursor: true,
        processed: true,
        inserted: true,
        updated: true,
        skipped: true,
        errorCount: true,
        lastError: true,
        startedAt: true,
        finishedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.knowledgeDocument.groupBy({
      by: ['documentStatus'],
      where: { sourceId: source.id },
      _count: { _all: true },
    }),
    prisma.knowledgeChunk.count({
      where: {
        isActive: true,
        document: { sourceId: source.id },
      },
    }),
  ])

  const counts = emptyCounts()
  for (const row of groupedCounts) {
    const key = row.documentStatus as keyof DocumentStatusCounts
    if (key in counts) counts[key] = row._count._all
  }

  const workRemaining =
    counts.pending +
    counts.fetched +
    counts.extracted +
    counts.embedded +
    counts.failed

  return {
    source,
    jobs,
    counts,
    activeChunks,
    workRemaining,
  }
}
