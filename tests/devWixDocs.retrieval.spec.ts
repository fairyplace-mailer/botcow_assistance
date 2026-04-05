jest.mock('../src/backend/openai', () => ({
  embedText: jest.fn(async () => ({ vector: [0.1, 0.2], dims: 2 })),
}));

import { embedText } from '../src/backend/openai';

const transactionMock = jest.fn(async (ops: unknown[]) => ops);
const docChunkUpdateMany = jest.fn(async () => ({ count: 1 }));
const docPageUpdateMany = jest.fn(async () => ({ count: 1 }));
const queryRawUnsafe = jest.fn();

jest.mock('../src/backend/db', () => ({
  prisma: {
    $queryRawUnsafe: (...args: unknown[]) => queryRawUnsafe(...args),
    $transaction: (...args: unknown[]) => transactionMock(...args),
    docChunk: {
      updateMany: (...args: unknown[]) => docChunkUpdateMany(...args),
    },
    docPage: {
      updateMany: (...args: unknown[]) => docPageUpdateMany(...args),
    },
  },
}));

describe('retrieveDevWixContext retention policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (embedText as jest.Mock).mockResolvedValue({ vector: [0.1, 0.2], dims: 2 });
    queryRawUnsafe.mockResolvedValue([]);
    transactionMock.mockImplementation(async (ops: unknown[]) => ops);
    docChunkUpdateMany.mockResolvedValue({ count: 1 });
    docPageUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('filters by persisted knowledge layers and retention markers in SQL', async () => {
    queryRawUnsafe.mockResolvedValueOnce([]);
    const { retrieveDevWixContext } = await import('../src/backend/devWixDocs/retrieve');

    await retrieveDevWixContext({ query: 'wix docs', topK: 2 });

    const sql = String(queryRawUnsafe.mock.calls[0]?.[0] ?? '');
    expect(sql).toContain('c."knowledgeLayer" = \'OFFICIAL\'');
    expect(sql).toContain('p."knowledgeLayer" = \'OFFICIAL\'');
    expect(sql).toContain('c."knowledgeLayer" = \'TEMPORARY\'');
    expect(sql).toContain('c."retentionUntil" >');
    expect(sql).toContain('p."retentionUntil" >');
  });

  it('returns official chunks and updates access timestamps', async () => {
    queryRawUnsafe.mockResolvedValueOnce([
      {
        id: 'chunk-1',
        pageId: 'page-1',
        url: 'https://dev.wix.com/docs/sdk',
        title: 'SDK Docs',
        content: 'official content',
        distance: 0.05,
      },
    ]);

    const { retrieveDevWixContext } = await import('../src/backend/devWixDocs/retrieve');
    const result = await retrieveDevWixContext({ query: 'sdk docs', topK: 1, maxChars: 1000 });

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]?.url).toBe('https://dev.wix.com/docs/sdk');
    expect(docChunkUpdateMany).toHaveBeenCalled();
    expect(docPageUpdateMany).toHaveBeenCalled();
  });

  it('skips access timestamp updates when nothing is returned', async () => {
    queryRawUnsafe.mockResolvedValueOnce([]);
    const { retrieveDevWixContext } = await import('../src/backend/devWixDocs/retrieve');

    const result = await retrieveDevWixContext({ query: 'none', topK: 1 });

    expect(result.chunks).toEqual([]);
    expect(docChunkUpdateMany).not.toHaveBeenCalled();
    expect(docPageUpdateMany).not.toHaveBeenCalled();
  });
});
