import { jest } from '@jest/globals';

jest.mock('../src/backend/openai', () => ({
  embedText: jest.fn(async () => ({ vector: [0.1, 0.2], dims: 2 })),
}));

import { embedText } from '../src/backend/openai';

const queryRawUnsafe = jest.fn();
const logInfo = jest.fn();
const logWarn = jest.fn();

jest.mock('../src/backend/log', () => ({
  logEvent: jest.fn().mockResolvedValue(undefined),
  logInfo: (...args: any[]) => logInfo(...args),
  logWarn: (...args: any[]) => logWarn(...args),
}));

jest.mock('../src/backend/db', () => ({
  prisma: {
    $queryRawUnsafe: (...args: unknown[]) => queryRawUnsafe(...args),
  },
}));

describe('retrieveDevWixContext knowledge contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.BOTCOW_DEV_WIX_EMBEDDING_BUDGET_LIMIT;
    delete process.env.BOTCOW_DEV_WIX_DB_BUDGET_LIMIT;
    logInfo.mockResolvedValue(undefined);
    logWarn.mockResolvedValue(undefined);
    (embedText as jest.Mock).mockResolvedValue({ vector: [0.1, 0.2], dims: 2 });
    queryRawUnsafe.mockResolvedValue([]);
  });

  it('queries only active ready knowledge documents from the dev wix source', async () => {
    queryRawUnsafe.mockResolvedValueOnce([{ count: 0 }]).mockResolvedValueOnce([]);

    const { retrieveDevWixContext } = await import('../src/backend/devWixDocs/retrieve');
    await retrieveDevWixContext({ query: 'wix docs', topK: 2 });

    const sql = String(queryRawUnsafe.mock.calls[1]?.[0] ?? '');
    expect(sql).toContain('FROM knowledge_chunks c');
    expect(sql).toContain('JOIN knowledge_documents d ON d.id = c.document_id');
    expect(sql).toContain('JOIN knowledge_sources s ON s.id = d.source_id');
    expect(sql).toContain("s.source_key = 'wix_docs_public'");
    expect(sql).toContain("s.status = 'active'");
    expect(sql).toContain("d.document_status = 'ready'");
  });

  it('returns knowledge chunks from canonical urls', async () => {
    queryRawUnsafe
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([
        {
          id: 'chunk-1',
          documentId: 'doc-1',
          canonicalUrl: 'https://dev.wix.com/docs/sdk',
          title: 'SDK Docs',
          chunkText: 'official content',
          distance: 0.05,
        },
      ]);

    const { retrieveDevWixContext } = await import('../src/backend/devWixDocs/retrieve');
    const result = await retrieveDevWixContext({ query: 'sdk docs', topK: 1, maxChars: 1000 });

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]).toEqual(
      expect.objectContaining({
        url: 'https://dev.wix.com/docs/sdk',
        title: 'SDK Docs',
        content: 'official content',
      }),
    );
  });

  it('returns empty chunks when embedding is empty', async () => {
    (embedText as jest.Mock).mockResolvedValueOnce({ vector: [], dims: 0 });
    const { retrieveDevWixContext } = await import('../src/backend/devWixDocs/retrieve');

    const result = await retrieveDevWixContext({ query: 'none', topK: 1 });

    expect(result.chunks).toEqual([]);
    expect(queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('warning mode reduces retrieval breadth at >=70% pressure', async () => {
    process.env.BOTCOW_DEV_WIX_EMBEDDING_BUDGET_LIMIT = '10';
    process.env.BOTCOW_DEV_WIX_DB_BUDGET_LIMIT = '10';
    queryRawUnsafe
      .mockResolvedValueOnce([{ count: 7 }])
      .mockResolvedValueOnce([
        {
          id: 'chunk-1',
          documentId: 'doc-1',
          canonicalUrl: 'https://dev.wix.com/docs/sdk',
          title: 'SDK Docs',
          chunkText: 'official content',
          distance: 0.05,
        },
      ]);

    const { retrieveDevWixContext } = await import('../src/backend/devWixDocs/retrieve');
    const result = await retrieveDevWixContext({ query: 'sdk docs', topK: 4, maxChars: 5000 });

    const sql = String(queryRawUnsafe.mock.calls[1]?.[0] ?? '');
    expect(sql).toContain('LIMIT 6');
    expect(result.budgetMode).toBe('warning');
    expect(result.effectiveTopK).toBe(2);
    expect(result.effectiveMaxChars).toBe(3000);
  });

  it('aggressive mode keeps retrieval alive but trims it hard at >=90% pressure', async () => {
    process.env.BOTCOW_DEV_WIX_EMBEDDING_BUDGET_LIMIT = '10';
    process.env.BOTCOW_DEV_WIX_DB_BUDGET_LIMIT = '10';
    queryRawUnsafe
      .mockResolvedValueOnce([{ count: 9 }])
      .mockResolvedValueOnce([
        {
          id: 'chunk-1',
          documentId: 'doc-1',
          canonicalUrl: 'https://dev.wix.com/docs/sdk',
          title: 'SDK Docs',
          chunkText: 'official content',
          distance: 0.05,
        },
      ]);

    const { retrieveDevWixContext } = await import('../src/backend/devWixDocs/retrieve');
    const result = await retrieveDevWixContext({ query: 'sdk docs', topK: 5, maxChars: 5000 });

    const sql = String(queryRawUnsafe.mock.calls[1]?.[0] ?? '');
    expect(sql).toContain('LIMIT 3');
    expect(result.budgetMode).toBe('aggressive');
    expect(result.effectiveTopK).toBe(2);
    expect(result.effectiveMaxChars).toBe(1500);
  });

  it('logs retrieval hit count and source count', async () => {
    queryRawUnsafe
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([
        {
          id: 'chunk-1',
          documentId: 'doc-1',
          canonicalUrl: 'https://dev.wix.com/docs/sdk',
          title: 'SDK Docs',
          chunkText: 'official content',
          distance: 0.05,
        },
      ]);

    const { retrieveDevWixContext } = await import('../src/backend/devWixDocs/retrieve');
    await retrieveDevWixContext({ query: 'sdk docs', topK: 1, maxChars: 1000 });

    expect(logInfo).toHaveBeenCalledWith(
      'dev_wix_retrieval_completed',
      expect.objectContaining({
        sourceKey: 'wix_docs_public',
        retrievalHitCount: 1,
        retrievalSourceCount: 1,
      }),
    );
  });
});
