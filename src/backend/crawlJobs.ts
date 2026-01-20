import { prisma } from './db';

export type CrawlJobStatus = 'running' | 'success' | 'error';

export type CrawlJobCreateInput = {
  kind: string;
  batchLimit?: number;
  metaJson?: unknown;
};

export type CrawlJobFinishInput = {
  status: Exclude<CrawlJobStatus, 'running'>;
  processed?: number;
  inserted?: number;
  updated?: number;
  deleted?: number;
  skipped?: number;
  errorsJson?: unknown;
  metaJson?: unknown;
};

export async function crawlJobStart(input: CrawlJobCreateInput) {
  return prisma.crawlJob.create({
    data: {
      kind: input.kind,
      startedAt: new Date(),
      status: 'running',
      ...(input.batchLimit !== undefined ? { batchLimit: input.batchLimit } : {}),
      ...(input.metaJson !== undefined ? { metaJson: input.metaJson as any } : {}),
    },
  });
}

export async function crawlJobFinish(id: string, input: CrawlJobFinishInput) {
  return prisma.crawlJob.update({
    where: { id },
    data: {
      finishedAt: new Date(),
      status: input.status,
      ...(input.processed !== undefined ? { processed: input.processed } : {}),
      ...(input.inserted !== undefined ? { inserted: input.inserted } : {}),
      ...(input.updated !== undefined ? { updated: input.updated } : {}),
      ...(input.deleted !== undefined ? { deleted: input.deleted } : {}),
      ...(input.skipped !== undefined ? { skipped: input.skipped } : {}),
      ...(input.errorsJson !== undefined ? { errorsJson: input.errorsJson as any } : {}),
      ...(input.metaJson !== undefined ? { metaJson: input.metaJson as any } : {}),
    },
  });
}

export async function withCrawlJob<T>(
  input: CrawlJobCreateInput,
  fn: (jobId: string) => Promise<{ result: T; finish: Omit<CrawlJobFinishInput, 'status'> }>,
): Promise<{ jobId: string; result: T }> {
  const job = await crawlJobStart(input);
  try {
    const { result, finish } = await fn(job.id);
    await crawlJobFinish(job.id, { status: 'success', ...finish });
    return { jobId: job.id, result };
  } catch (e: any) {
    await crawlJobFinish(job.id, {
      status: 'error',
      errorsJson: {
        name: e?.name ?? null,
        message: e?.message ?? String(e),
        stack: e?.stack ?? null,
      },
    }).catch(() => undefined);
    throw e;
  }
}
