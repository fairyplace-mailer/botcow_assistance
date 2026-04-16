const prismaMock = {
  knowledgeSource: {
    findUnique: jest.fn(),
  },
  knowledgeJob: {
    findMany: jest.fn(),
  },
  knowledgeDocument: {
    groupBy: jest.fn(),
  },
  knowledgeChunk: {
    count: jest.fn(),
  },
}

jest.mock('../src/backend/db', () => ({
  prisma: prismaMock,
}))

import { getDevWixStatusSummary } from '../src/backend/devWixDocs/status'

describe('getDevWixStatusSummary', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('returns empty summary when source is missing', async () => {
    prismaMock.knowledgeSource.findUnique.mockResolvedValue(null)

    const result = await getDevWixStatusSummary()

    expect(result.source).toBeNull()
    expect(result.jobs).toEqual([])
    expect(result.activeChunks).toBe(0)
    expect(result.workRemaining).toBe(0)
    expect(result.counts).toEqual({
      pending: 0,
      fetched: 0,
      extracted: 0,
      embedded: 0,
      ready: 0,
      failed: 0,
      deleted: 0,
    })
  })

  test('returns normalized counts and workRemaining for existing source', async () => {
    prismaMock.knowledgeSource.findUnique.mockResolvedValue({
      id: 'src-1',
      sourceKey: 'wix_docs_public',
      sourceKind: 'public_http_docs',
      status: 'active',
      seedManifestPath: 'docs/rag/dev_wix.seed.txt',
      scopeAllowlist: 'https://dev.wix.com/docs/*',
      createdAt: new Date('2026-04-16T00:00:00.000Z'),
      updatedAt: new Date('2026-04-16T00:00:00.000Z'),
    })

    prismaMock.knowledgeJob.findMany.mockResolvedValue([
      {
        id: 'job-1',
        jobKind: 'ingest',
        jobStatus: 'done',
        batchLimit: 25,
        cursor: null,
        processed: 25,
        inserted: 10,
        updated: 40,
        skipped: 5,
        errorCount: 0,
        lastError: null,
        startedAt: new Date('2026-04-16T00:10:00.000Z'),
        finishedAt: new Date('2026-04-16T00:11:00.000Z'),
        createdAt: new Date('2026-04-16T00:10:00.000Z'),
        updatedAt: new Date('2026-04-16T00:11:00.000Z'),
      },
    ])

    prismaMock.knowledgeDocument.groupBy.mockResolvedValue([
      { documentStatus: 'pending', _count: { _all: 3 } },
      { documentStatus: 'ready', _count: { _all: 11 } },
      { documentStatus: 'failed', _count: { _all: 2 } },
      { documentStatus: 'deleted', _count: { _all: 1 } },
    ])

    prismaMock.knowledgeChunk.count.mockResolvedValue(77)

    const result = await getDevWixStatusSummary()

    expect(result.source?.id).toBe('src-1')
    expect(result.jobs).toHaveLength(1)
    expect(result.activeChunks).toBe(77)
    expect(result.counts.pending).toBe(3)
    expect(result.counts.ready).toBe(11)
    expect(result.counts.failed).toBe(2)
    expect(result.counts.deleted).toBe(1)
    expect(result.workRemaining).toBe(5)
  })
})
