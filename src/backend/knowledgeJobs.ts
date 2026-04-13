import { prisma } from './db';

export type KnowledgeJobFinishInput = {
  status: 'done' | 'failed';
  processed?: number;
  inserted?: number;
  updated?: number;
  skipped?: number;
  errorCount?: number;
  lastError?: string | null;
  cursor?: string | null;
};

type ReusableKnowledgeJob = {
  id: string;
  jobStatus: 'queued' | 'running' | 'paused' | 'failed';
  cursor: string | null;
};

export async function findReusableKnowledgeJob(input: {
  sourceId: string;
  jobKind: string;
  cursor?: string | null;
}): Promise<ReusableKnowledgeJob | null> {
  return prisma.knowledgeJob.findFirst({
    where: {
      sourceId: input.sourceId,
      jobKind: input.jobKind,
      jobStatus: { in: ['queued', 'running', 'paused', 'failed'] },
      ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
    },
    orderBy: [{ updatedAt: 'desc' }],
    select: {
      id: true,
      jobStatus: true,
      cursor: true,
    },
  }) as Promise<ReusableKnowledgeJob | null>;
}

export async function createOrReuseKnowledgeJob(input: {
  sourceId: string;
  jobKind: string;
  batchLimit?: number;
  cursor?: string | null;
}): Promise<{ job: { id: string; jobStatus?: string | null; cursor?: string | null }; reused: boolean }> {
  const reusable = await findReusableKnowledgeJob({
    sourceId: input.sourceId,
    jobKind: input.jobKind,
    ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
  });

  if (reusable) {
    return { job: reusable, reused: true };
  }

  const job = await prisma.knowledgeJob.create({
    data: {
      sourceId: input.sourceId,
      jobKind: input.jobKind,
      jobStatus: 'queued',
      ...(typeof input.batchLimit === 'number' ? { batchLimit: input.batchLimit } : {}),
      ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
    },
  });

  return { job, reused: false };
}

export async function markKnowledgeJobRunning(id: string) {
  return prisma.knowledgeJob.update({
    where: { id },
    data: {
      jobStatus: 'running',
      finishedAt: null,
      lastError: null,
    },
  });
}

export async function createKnowledgeJob(input: {
  sourceKey: string;
  jobKind: string;
  batchLimit?: number;
  cursor?: string | null;
}) {
  const source = await prisma.knowledgeSource.findUnique({
    where: { sourceKey: input.sourceKey },
    select: { id: true },
  });

  if (!source) {
    throw new Error(`knowledge_source_missing:${input.sourceKey}`);
  }

  return prisma.knowledgeJob.create({
    data: {
      sourceId: source.id,
      jobKind: input.jobKind,
      jobStatus: 'running',
      ...(typeof input.batchLimit === 'number' ? { batchLimit: input.batchLimit } : {}),
      ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
    },
  });
}

export async function finishKnowledgeJob(id: string, input: KnowledgeJobFinishInput) {
  return prisma.knowledgeJob.update({
    where: { id },
    data: {
      jobStatus: input.status,
      finishedAt: new Date(),
      ...(typeof input.processed === 'number' ? { processed: input.processed } : {}),
      ...(typeof input.inserted === 'number' ? { inserted: input.inserted } : {}),
      ...(typeof input.updated === 'number' ? { updated: input.updated } : {}),
      ...(typeof input.skipped === 'number' ? { skipped: input.skipped } : {}),
      ...(typeof input.errorCount === 'number' ? { errorCount: input.errorCount } : {}),
      ...(input.lastError !== undefined ? { lastError: input.lastError } : {}),
      ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
    },
  });
}

export async function withKnowledgeJob<T>(
  input: {
    sourceKey: string;
    jobKind: string;
    batchLimit?: number;
    cursor?: string | null;
  },
  fn: (jobId: string) => Promise<{
    result: T;
    finish: Omit<KnowledgeJobFinishInput, 'status'>;
  }>,
): Promise<{ jobId: string; result: T }> {
  const job = await createKnowledgeJob(input);

  try {
    const { result, finish } = await fn(job.id);
    await finishKnowledgeJob(job.id, { status: 'done', ...finish });
    return { jobId: job.id, result };
  } catch (error: any) {
    await finishKnowledgeJob(job.id, {
      status: 'failed',
      errorCount: 1,
      lastError: error?.message ?? String(error),
    }).catch(() => undefined);
    throw error;
  }
}
