import { jest } from '@jest/globals';

const knowledgeSourceUpsert = jest.fn();
const knowledgeJobFindFirst = jest.fn();
const knowledgeJobCreate = jest.fn();
const knowledgeJobUpdate = jest.fn();
const knowledgeDocumentFindFirst = jest.fn();
const knowledgeDocumentCreate = jest.fn();
const knowledgeDocumentUpdate = jest.fn();
const logInfo = jest.fn();
const logWarn = jest.fn();

jest.mock('../../src/backend/log', () => ({
  logEvent: jest.fn().mockResolvedValue(undefined),
  logInfo: (...args: any[]) => logInfo(...args),
  logWarn: (...args: any[]) => logWarn(...args),
}));

jest.mock('../../src/backend/db', () => ({
  prisma: {
    knowledgeSource: { upsert: (...args: any[]) => knowledgeSourceUpsert(...args) },
    knowledgeJob: {
      findFirst: (...args: any[]) => knowledgeJobFindFirst(...args),
      create: (...args: any[]) => knowledgeJobCreate(...args),
      update: (...args: any[]) => knowledgeJobUpdate(...args),
    },
    knowledgeDocument: {
      findFirst: (...args: any[]) => knowledgeDocumentFindFirst(...args),
      create: (...args: any[]) => knowledgeDocumentCreate(...args),
      update: (...args: any[]) => knowledgeDocumentUpdate(...args),
    },
  },
}));

const loadDevWixSeedManifest = jest.fn();

jest.mock('../../src/backend/devWixDocs/seedManifest', () => ({
  DEV_WIX_SCOPE_ALLOWLIST: 'https://dev.wix.com/docs/*',
  DEV_WIX_SEED_MANIFEST_PATH: 'docs/rag/dev_wix.seed.txt',
  DEV_WIX_SOURCE_KEY: 'wix_docs_public',
  DEV_WIX_SOURCE_KIND: 'public_http_docs',
  loadDevWixSeedManifest: (...args: any[]) => loadDevWixSeedManifest(...args),
}));

describe('bootstrapDevWixKnowledge contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    logInfo.mockResolvedValue(undefined);
    logWarn.mockResolvedValue(undefined);
    knowledgeSourceUpsert.mockResolvedValue({ id: 'source-1' });
    knowledgeJobFindFirst.mockResolvedValue(null);
    knowledgeJobCreate.mockResolvedValue({ id: 'job-1', jobStatus: 'queued', cursor: null });
    knowledgeJobUpdate.mockResolvedValue({ id: 'job-1' });
    knowledgeDocumentFindFirst.mockResolvedValue(null);
    knowledgeDocumentCreate.mockResolvedValue({});
    knowledgeDocumentUpdate.mockResolvedValue({});
    loadDevWixSeedManifest.mockReturnValue({
      manifestPath: 'docs/rag/dev_wix.seed.txt',
      urls: ['https://dev.wix.com/docs/sdk', 'https://dev.wix.com/docs/velo'],
      rejected: [{ raw: 'https://example.com/x', reason: 'invalid' }],
    });
  });

  test('creates deterministic pending documents from seed manifest batch', async () => {
    const { bootstrapDevWixKnowledge } = await import('../../src/backend/devWixDocs/bootstrap');
    const result = await bootstrapDevWixKnowledge({ batchLimit: 1, cursor: 0 });

    expect(result.totalInManifest).toBe(2);
    expect(result.processed).toBe(1);
    expect(result.inserted).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.nextCursor).toBe(1);
    expect(result.reusedJob).toBe(false);
    expect(result.resumedFromCursor).toBe(0);

    expect(knowledgeJobCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceId: 'source-1',
        jobKind: 'bootstrap',
        jobStatus: 'queued',
        batchLimit: 1,
        cursor: '0',
      }),
    });

    expect(knowledgeJobUpdate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          jobStatus: 'running',
          finishedAt: null,
          lastError: null,
        }),
      }),
    );

    expect(knowledgeDocumentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        canonicalUrl: 'https://dev.wix.com/docs/sdk',
        originalUrl: 'https://dev.wix.com/docs/sdk',
        sourceSection: 'wix_docs_public',
        documentStatus: 'pending',
      }),
    });
  });

  test('rerun is idempotent for existing canonical url', async () => {
    knowledgeDocumentFindFirst.mockResolvedValueOnce({ id: 'doc-1', documentStatus: 'ready' });

    const { bootstrapDevWixKnowledge } = await import('../../src/backend/devWixDocs/bootstrap');
    const result = await bootstrapDevWixKnowledge({ batchLimit: 1, cursor: 0 });

    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(1);
    expect(knowledgeDocumentUpdate).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: expect.objectContaining({
        sourceId: 'source-1',
        originalUrl: 'https://dev.wix.com/docs/sdk',
      }),
    });
  });

  test('reuses existing bootstrap job and resumes from saved cursor when cursor is omitted', async () => {
    knowledgeJobFindFirst.mockResolvedValueOnce({
      id: 'job-prev',
      jobStatus: 'paused',
      cursor: '1',
    });

    const { bootstrapDevWixKnowledge } = await import('../../src/backend/devWixDocs/bootstrap');
    const result = await bootstrapDevWixKnowledge({ batchLimit: 1 });

    expect(result.jobId).toBe('job-prev');
    expect(result.reusedJob).toBe(true);
    expect(result.resumedFromCursor).toBe(1);
    expect(result.nextCursor).toBe(null);
    expect(knowledgeJobCreate).not.toHaveBeenCalled();

    expect(knowledgeDocumentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        canonicalUrl: 'https://dev.wix.com/docs/velo',
        originalUrl: 'https://dev.wix.com/docs/velo',
      }),
    });
  });

  test('logs bootstrap job and canonical urls', async () => {
    const { bootstrapDevWixKnowledge } = await import('../../src/backend/devWixDocs/bootstrap');
    await bootstrapDevWixKnowledge({ batchLimit: 1, cursor: 0 });

    expect(logInfo).toHaveBeenCalledWith(
      'dev_wix_bootstrap_started',
      expect.objectContaining({
        sourceKey: 'wix_docs_public',
        jobId: 'job-1',
      }),
    );

    expect(logInfo).toHaveBeenCalledWith(
      'dev_wix_bootstrap_document_registered',
      expect.objectContaining({
        sourceKey: 'wix_docs_public',
        jobId: 'job-1',
        canonicalUrl: 'https://dev.wix.com/docs/sdk',
      }),
    );

    expect(logInfo).toHaveBeenCalledWith(
      'dev_wix_bootstrap_completed',
      expect.objectContaining({
        sourceKey: 'wix_docs_public',
        jobId: 'job-1',
      }),
    );
  });
});
