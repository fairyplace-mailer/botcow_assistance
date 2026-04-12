import { jest } from '@jest/globals';

const knowledgeSourceUpsert = jest.fn();
const knowledgeJobCreate = jest.fn();
const knowledgeJobUpdate = jest.fn();
const knowledgeDocumentFindFirst = jest.fn();
const knowledgeDocumentCreate = jest.fn();
const knowledgeDocumentUpdate = jest.fn();

jest.mock('../../src/backend/db', () => ({
  prisma: {
    knowledgeSource: { upsert: (...args: any[]) => knowledgeSourceUpsert(...args) },
    knowledgeJob: {
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
  DEV_WIX_SOURCE_KEY: 'dev_wix_docs',
  DEV_WIX_SOURCE_KIND: 'public_http_docs',
  loadDevWixSeedManifest: (...args: any[]) => loadDevWixSeedManifest(...args),
}));

describe('bootstrapDevWixKnowledge contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    knowledgeSourceUpsert.mockResolvedValue({ id: 'source-1' });
    knowledgeJobCreate.mockResolvedValue({ id: 'job-1' });
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

    expect(knowledgeDocumentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        canonicalUrl: 'https://dev.wix.com/docs/sdk',
        originalUrl: 'https://dev.wix.com/docs/sdk',
        documentStatus: 'pending',
      }),
    });
  });

  test('rerun is idempotent for existing canonical url', async () => {
    knowledgeDocumentFindFirst.mockResolvedValueOnce({ id: 'doc-1' });
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
});
