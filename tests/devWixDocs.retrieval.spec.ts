jest.mock('../src/backend/openai', () => ({
  embedText: jest.fn(async () => ({ vector: [0.1, 0.2], dims: 2 })),
}));

import { embedText } from '../src/backend/openai';

const queryRawUnsafe = jest.fn();

jest.mock('../src/backend/db', () => ({
  prisma: {
    $queryRawUnsafe: (...args: unknown[]) => queryRawUnsafe(...args),
  },
}));

describe('retrieveDevWixContext knowledge contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (embedText as jest.Mock).mockResolvedValue({ vector: [0.1, 0.2], dims: 2 });
    queryRawUnsafe.mockResolvedValue([]);
  });

  it('queries only active ready knowledge documents from the dev wix source', async () => {
    const { retrieveDevWixContext } = await import('../src/backend/devWixDocs/retrieve');

    await retrieveDevWixContext({ query: 'wix docs', topK: 2 });

    const sql = String(queryRawUnsafe.mock.calls[0]?.[0] ?? '');
    expect(sql).toContain('FROM knowledge_chunks c');
    expect(sql).toContain('JOIN knowledge_documents d ON d.id = c.document_id');
    expect(sql).toContain('JOIN knowledge_sources s ON s.id = d.source_id');
    expect(sql).toContain("s.source_key = 'dev_wix_docs'");
    expect(sql).toContain("s.status = 'active'");
    expect(sql).toContain("d.document_status = 'ready'");
  });

  it('returns knowledge chunks from canonical urls', async () => {
    queryRawUnsafe.mockResolvedValueOnce([
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
});
