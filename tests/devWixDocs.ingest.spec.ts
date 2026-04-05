import { jest } from '@jest/globals';

const docPageCount = jest.fn(async () => 0);
const docChunkCount = jest.fn(async () => 0);
const docPageFindUnique = jest.fn(async () => null);
const docPageFindMany = jest.fn(async () => []);
const docPageUpdate = jest.fn(async () => ({}));
const docPageUpsert = jest.fn(async (args: any) => ({ id: args.create.url, ...args.create }));
const docPageDeleteMany = jest.fn(async () => ({ count: 0 }));
const docChunkCreateMany = jest.fn(async () => ({ count: 1 }));
const docChunkDeleteMany = jest.fn(async () => ({ count: 0 }));
const docChunkFindMany = jest.fn(async () => []);
const docChunkUpdateMany = jest.fn(async () => ({ count: 0 }));
const executeRawUnsafe = jest.fn(async () => 0);
const queryRaw = jest.fn(async () => []);

jest.mock('../src/backend/openai', () => ({
  createEmbeddings: jest.fn(async ({ input }: { input: string[] }) => ({
    data: input.map((_, i) => ({ embedding: [0.1 + i, 0.2, 0.3] })),
  })),
}));

jest.mock('@/backend/db', () => ({
  prisma: {
    docPage: {
      count: (...args: any[]) => docPageCount(...args),
      findUnique: (...args: any[]) => docPageFindUnique(...args),
      findMany: (...args: any[]) => docPageFindMany(...args),
      update: (...args: any[]) => docPageUpdate(...args),
      upsert: (...args: any[]) => docPageUpsert(...args),
      deleteMany: (...args: any[]) => docPageDeleteMany(...args),
    },
    docChunk: {
      count: (...args: any[]) => docChunkCount(...args),
      createMany: (...args: any[]) => docChunkCreateMany(...args),
      deleteMany: (...args: any[]) => docChunkDeleteMany(...args),
      findMany: (...args: any[]) => docChunkFindMany(...args),
      updateMany: (...args: any[]) => docChunkUpdateMany(...args),
    },
    $executeRawUnsafe: (...args: any[]) => executeRawUnsafe(...args),
    $queryRaw: (...args: any[]) => queryRaw(...args),
    $transaction: async (cb: any) =>
      cb({
        docPage: {
          upsert: (...args: any[]) => docPageUpsert(...args),
        },
        docChunk: {
          deleteMany: (...args: any[]) => docChunkDeleteMany(...args),
          createMany: (...args: any[]) => docChunkCreateMany(...args),
        },
      }),
  },
}));

describe('ingestDevWixArticles retention and budget policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    docPageCount.mockResolvedValue(1);
    docChunkCount.mockResolvedValue(1);
    docPageFindUnique.mockResolvedValue(null);
    docPageFindMany.mockResolvedValue([]);
    docPageUpdate.mockResolvedValue({});
    queryRaw.mockResolvedValue([]);
    docChunkDeleteMany.mockResolvedValue({ count: 0 });
    docPageDeleteMany.mockResolvedValue({ count: 0 });
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '<html lang="en"><head><title>SDK Docs</title></head><body><a href="/docs/sdk">sdk</a><main>Hello world from Wix docs</main></body></html>',
    })) as any;
  });

  test('creates official chunks without ordinary TTL', async () => {
    docPageFindMany.mockResolvedValue([{ id: 'page-1', url: 'https://dev.wix.com/docs/sdk', refreshIntervalHours: 24 }]);

    const { ingestDevWixArticles } = await import('../src/backend/devWixDocs/ingest');
    const result = await ingestDevWixArticles({
      maxEmbeddings: 20,
      discoverLinks: false,
      force: true,
      limitPages: 1,
    });

    expect(docPageFindMany).toHaveBeenCalledTimes(1);
    expect(result.stoppedReason).toBe('completed');
    expect(result.budgetMode).toBe('normal');

    const upsertCall = docPageUpsert.mock.calls[0]?.[0];
    expect(upsertCall?.create.knowledgeLayer).toBe('OFFICIAL');
    expect(upsertCall?.create.retentionUntil ?? null).toBeNull();

    const chunkCreateManyCall = docChunkCreateMany.mock.calls[0]?.[0];
    expect(chunkCreateManyCall?.data.length).toBeGreaterThan(0);
    for (const chunk of chunkCreateManyCall?.data ?? []) {
      expect(chunk.knowledgeLayer).toBe('OFFICIAL');
      expect(chunk.retentionUntil ?? null).toBeNull();
    }
  });

  test('cleanup deletes only expired temporary records', async () => {
    docPageDeleteMany.mockResolvedValue({ count: 2 });
    docChunkDeleteMany.mockResolvedValue({ count: 3 });

    const { ingestDevWixArticles } = await import('../src/backend/devWixDocs/ingest');
    await ingestDevWixArticles({ maxEmbeddings: 0, discoverLinks: false, force: true, limitPages: 0 });

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

  test('warning mode reduces scope but keeps official writes official', async () => {
    docChunkCount.mockResolvedValue(7);
    docPageFindMany.mockResolvedValue([{ id: 'page-1', url: 'https://dev.wix.com/docs/sdk', refreshIntervalHours: 24 }]);

    const { ingestDevWixArticles } = await import('../src/backend/devWixDocs/ingest');
    const result = await ingestDevWixArticles({ maxEmbeddings: 20, discoverLinks: true, force: true, limitPages: 5 });

    expect(result.budgetMode).toBe('warning');
    const upsertCall = docPageUpsert.mock.calls[0]?.[0];
    expect(upsertCall?.create.knowledgeLayer).toBe('OFFICIAL');
    expect(upsertCall?.create.retentionUntil ?? null).toBeNull();
  });
});
