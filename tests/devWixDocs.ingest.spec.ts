const docPageCount = jest.fn();
const docChunkCount = jest.fn();
const docChunkDeleteMany = jest.fn(async () => ({ count: 0 }));
const docPageDeleteMany = jest.fn(async () => ({ count: 0 }));
const docPageFindUnique = jest.fn();
const docPageCreate = jest.fn(async (args: any) => ({ id: 'seed-page', ...args.data }));
const docPageUpsert = jest.fn(async (args: any) => ({ id: 'page-1', ...args.create }));
const docPageFindMany = jest.fn(async () => []);
const docPageUpdate = jest.fn(async () => ({}));
const docChunkCreate = jest.fn(async (args: any) => ({ id: `chunk-${args.data.idx}`, ...args.data }));
const executeRawUnsafe = jest.fn(async () => 1);
const txDocPageUpdateMany = jest.fn(async () => ({ count: 0 }));
const transactionMock = jest.fn(async (cbOrOps: any) => {
  if (typeof cbOrOps === 'function') {
    return cbOrOps({ docPage: { findMany: docPageFindMany, updateMany: txDocPageUpdateMany } });
  }
  return cbOrOps;
});

jest.mock('../src/backend/openai', () => ({
  embedTexts: jest.fn(async (texts: string[]) => ({
    vectors: texts.map(() => [0.1, 0.2]),
    dims: 2,
    model: 'text-embedding-3-large',
  })),
}));

jest.mock('@/backend/db', () => ({
  prisma: {
    $transaction: (...args: unknown[]) => transactionMock(...args),
    $executeRawUnsafe: (...args: unknown[]) => executeRawUnsafe(...args),
    docPage: {
      count: (...args: unknown[]) => docPageCount(...args),
      deleteMany: (...args: unknown[]) => docPageDeleteMany(...args),
      findUnique: (...args: unknown[]) => docPageFindUnique(...args),
      create: (...args: unknown[]) => docPageCreate(...args),
      upsert: (...args: unknown[]) => docPageUpsert(...args),
      findMany: (...args: unknown[]) => docPageFindMany(...args),
      update: (...args: unknown[]) => docPageUpdate(...args),
      updateMany: (...args: unknown[]) => txDocPageUpdateMany(...args),
      delete: jest.fn(async () => ({})),
    },
    docChunk: {
      count: (...args: unknown[]) => docChunkCount(...args),
      deleteMany: (...args: unknown[]) => docChunkDeleteMany(...args),
      create: (...args: unknown[]) => docChunkCreate(...args),
    },
  },
}));

describe('ingestDevWixArticles retention and budget policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    docPageCount.mockResolvedValue(1);
    docChunkCount.mockResolvedValue(1);
    docPageFindUnique.mockResolvedValue(null);
    docPageFindMany.mockResolvedValue([]);
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '<html lang="en"><head><title>SDK Docs</title></head><body><a href="/docs/sdk">sdk</a><main>Hello world from Wix docs</main></body></html>',
    })) as any;
  });

  it('stops new ingest at >=90 percent budget pressure', async () => {
    docChunkCount.mockResolvedValue(9);
    const { ingestDevWixArticles } = await import('../src/backend/devWixDocs/ingest');

    const result = await ingestDevWixArticles({ maxEmbeddings: 10, discoverLinks: true });

    expect(result.budgetMode).toBe('aggressive');
    expect(result.stoppedReason).toBe('budget_aggressive_mode');
    expect(docPageCreate).not.toHaveBeenCalled();
    expect(docChunkCreate).not.toHaveBeenCalled();
  });

  it('creates temporary seed pages with retentionUntil and temporary layer', async () => {
    const { ingestDevWixArticles } = await import('../src/backend/devWixDocs/ingest');

    await ingestDevWixArticles({ maxEmbeddings: 20, discoverLinks: true, maxDiscoveredPages: 1 });

    expect(docPageCreate).toHaveBeenCalled();
    const createArg = docPageCreate.mock.calls[0][0];
    expect(createArg.data.knowledgeLayer).toBe('TEMPORARY');
    expect(createArg.data.retentionUntil).toBeInstanceOf(Date);
    expect(createArg.data.retentionReason).toBe('seed_placeholder');
  });

  it('creates official chunks without ordinary TTL', async () => {
    docPageFindMany.mockResolvedValue([{ id: 'page-1', url: 'https://dev.wix.com/docs/sdk', refreshIntervalHours: 24 }]);
    const { ingestDevWixArticles } = await import('../src/backend/devWixDocs/ingest');

    await ingestDevWixArticles({ maxEmbeddings: 20, discoverLinks: false, force: true, limitPages: 1 });

    expect(docPageFindMany).toHaveBeenCalledTimes(1);
    expect(docPageUpdate).toHaveBeenCalledTimes(0);

    expect(docPageUpsert).toHaveBeenCalled();
    const upsertArg = docPageUpsert.mock.calls[0][0];
    expect(upsertArg.create.knowledgeLayer).toBe('OFFICIAL');
    expect(upsertArg.create.retentionUntil).toBeNull();

    expect(docChunkCreate).toHaveBeenCalled();
    const chunkArg = docChunkCreate.mock.calls[0][0];
    expect(chunkArg.data.knowledgeLayer).toBe('OFFICIAL');
    expect(chunkArg.data.retentionUntil).toBeNull();
  });

  it('cleanup deletes only expired temporary records', async () => {
    const { ingestDevWixArticles } = await import('../src/backend/devWixDocs/ingest');

    await ingestDevWixArticles({ maxEmbeddings: 20, discoverLinks: false });

    expect(docChunkDeleteMany).toHaveBeenCalledWith({
      where: {
        knowledgeLayer: 'TEMPORARY',
        retentionUntil: { lte: expect.any(Date) },
      },
    });
    expect(docPageDeleteMany).toHaveBeenCalledWith({
      where: {
        knowledgeLayer: 'TEMPORARY',
        retentionUntil: { lte: expect.any(Date) },
      },
    });
  });

  it('warning mode reduces scope but keeps official writes official', async () => {
    docChunkCount.mockResolvedValue(7);
    docPageFindMany.mockResolvedValue([{ id: 'page-1', url: 'https://dev.wix.com/docs/sdk', refreshIntervalHours: 24 }]);
    const { ingestDevWixArticles } = await import('../src/backend/devWixDocs/ingest');

    const result = await ingestDevWixArticles({ maxEmbeddings: 10, force: true, limitPages: 5, maxChunksPerPage: 8 });

    expect(result.budgetMode).toBe('warning');
    expect(result.maxChunksPerPage).toBeLessThanOrEqual(2);
    const chunkArg = docChunkCreate.mock.calls[0][0];
    expect(chunkArg.data.knowledgeLayer).toBe('OFFICIAL');
    expect(chunkArg.data.retentionUntil).toBeNull();
  });
});
