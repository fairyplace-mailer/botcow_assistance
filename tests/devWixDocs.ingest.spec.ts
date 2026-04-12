import { jest } from '@jest/globals';
import { hashText } from '../src/backend/devWixDocs/hash';
import { htmlToMarkdown } from '../src/backend/devWixDocs/markdown';

type Doc = {
  id: string;
  sourceId: string;
  canonicalUrl: string;
  originalUrl: string;
  contentHash: string | null;
  documentStatus: 'pending' | 'fetched' | 'extracted' | 'embedded' | 'ready' | 'failed' | 'deleted';
  createdAt: Date;
  fetchedAt: Date | null;
  lastHttpStatus?: number | null;
  title?: string | null;
  normalizedMarkdown?: string | null;
  embeddedAt?: Date | null;
  lastError?: string | null;
};

type Chunk = {
  id: string;
  documentId: string;
  chunkIndex: number;
  chunkText: string;
  tokenCount: number;
  textHash: string;
};

const embedText = jest.fn();
const createKnowledgeJob = jest.fn();
const finishKnowledgeJob = jest.fn();
const logInfo = jest.fn();
const logWarn = jest.fn();

let docsState: Doc[] = [];
let chunksState: Chunk[] = [];
let chunkSeq = 1;

const knowledgeSourceFindUnique = jest.fn();
const knowledgeDocumentCount = jest.fn();
const knowledgeChunkCount = jest.fn();
const knowledgeDocumentFindMany = jest.fn();
const knowledgeDocumentFindFirst = jest.fn();
const knowledgeDocumentCreate = jest.fn();
const knowledgeDocumentUpdate = jest.fn();
const knowledgeChunkDeleteMany = jest.fn();
const knowledgeChunkCreateMany = jest.fn();
const knowledgeChunkFindMany = jest.fn();
const executeRawUnsafe = jest.fn();

jest.mock('../src/backend/log', () => ({
  logEvent: jest.fn().mockResolvedValue(undefined),
  logInfo: (...args: any[]) => logInfo(...args),
  logWarn: (...args: any[]) => logWarn(...args),
}));

jest.mock('../src/backend/openai', () => ({
  embedText: (...args: any[]) => embedText(...args),
}));

jest.mock('../src/backend/knowledgeJobs', () => ({
  createKnowledgeJob: (...args: any[]) => createKnowledgeJob(...args),
  finishKnowledgeJob: (...args: any[]) => finishKnowledgeJob(...args),
}));

jest.mock('../src/backend/db', () => ({
  prisma: {
    knowledgeSource: { findUnique: (...args: any[]) => knowledgeSourceFindUnique(...args) },
    knowledgeDocument: {
      count: (...args: any[]) => knowledgeDocumentCount(...args),
      findMany: (...args: any[]) => knowledgeDocumentFindMany(...args),
      findFirst: (...args: any[]) => knowledgeDocumentFindFirst(...args),
      create: (...args: any[]) => knowledgeDocumentCreate(...args),
      update: (...args: any[]) => knowledgeDocumentUpdate(...args),
    },
    knowledgeChunk: {
      count: (...args: any[]) => knowledgeChunkCount(...args),
      deleteMany: (...args: any[]) => knowledgeChunkDeleteMany(...args),
      createMany: (...args: any[]) => knowledgeChunkCreateMany(...args),
      findMany: (...args: any[]) => knowledgeChunkFindMany(...args),
    },
    $executeRawUnsafe: (...args: any[]) => executeRawUnsafe(...args),
  },
}));

function makeHtml(body: string): string {
  return `<html><head><title>SDK Docs</title></head><body><main>${body}</main></body></html>`;
}

describe('ingestDevWixArticles knowledge contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.BOTCOW_DEV_WIX_EMBEDDING_BUDGET_LIMIT;
    delete process.env.BOTCOW_DEV_WIX_DB_BUDGET_LIMIT;

    chunkSeq = 1;
    chunksState = [];
    docsState = [
      {
        id: 'doc-1',
        sourceId: 'source-1',
        canonicalUrl: 'https://dev.wix.com/docs/sdk',
        originalUrl: 'https://dev.wix.com/docs/sdk',
        contentHash: null,
        documentStatus: 'pending',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        fetchedAt: null,
        lastHttpStatus: null,
        normalizedMarkdown: null,
        title: null,
        embeddedAt: null,
        lastError: null,
      },
    ];

    logInfo.mockResolvedValue(undefined);
    logWarn.mockResolvedValue(undefined);
    createKnowledgeJob.mockResolvedValue({ id: 'job-1' });
    finishKnowledgeJob.mockResolvedValue({ id: 'job-1' });

    embedText.mockResolvedValue({ vector: [0.1, 0.2], dims: 2, model: 'text-embedding-3-small' });
    knowledgeSourceFindUnique.mockResolvedValue({ id: 'source-1', sourceKey: 'wix_docs_public' });
    knowledgeDocumentCount.mockImplementation(async () => docsState.filter((x) => x.documentStatus === 'ready').length);
    knowledgeChunkCount.mockImplementation(async () => chunksState.length);
    knowledgeDocumentFindMany.mockImplementation(async () => docsState);
    knowledgeDocumentFindFirst.mockImplementation(async (args: any) => {
      const where = args?.where ?? {};
      return docsState.find((doc) => doc.sourceId === where.sourceId && doc.canonicalUrl === where.canonicalUrl) ?? null;
    });
    knowledgeDocumentCreate.mockImplementation(async (args: any) => {
      const data = args.data;
      const created: Doc = {
        id: data.id ?? `doc-${docsState.length + 1}`,
        sourceId: data.sourceId,
        canonicalUrl: data.canonicalUrl,
        originalUrl: data.originalUrl,
        contentHash: data.contentHash ?? null,
        documentStatus: data.documentStatus,
        createdAt: new Date(),
        fetchedAt: null,
        lastHttpStatus: null,
        normalizedMarkdown: data.normalizedMarkdown ?? null,
        title: data.title ?? null,
        embeddedAt: null,
        lastError: null,
      };
      docsState.push(created);
      return created;
    });
    knowledgeDocumentUpdate.mockImplementation(async (args: any) => {
      const id = args.where.id;
      const doc = docsState.find((item) => item.id === id);
      if (!doc) throw new Error(`doc not found: ${id}`);
      Object.assign(doc, args.data);
      return doc;
    });
    knowledgeChunkDeleteMany.mockImplementation(async (args: any) => {
      const documentId = args?.where?.documentId;
      if (documentId) chunksState = chunksState.filter((item) => item.documentId !== documentId);
      return { count: 0 };
    });
    knowledgeChunkCreateMany.mockImplementation(async (args: any) => {
      for (const row of args.data ?? []) {
        chunksState.push({
          id: `chunk-${chunkSeq++}`,
          documentId: row.documentId,
          chunkIndex: row.chunkIndex,
          chunkText: row.chunkText,
          tokenCount: row.tokenCount,
          textHash: row.textHash,
        });
      }
      return { count: args.data?.length ?? 0 };
    });
    knowledgeChunkFindMany.mockImplementation(async (args: any) => {
      const documentId = args?.where?.documentId;
      return chunksState
        .filter((item) => item.documentId === documentId)
        .sort((a, b) => a.chunkIndex - b.chunkIndex)
        .map((item) => ({ id: item.id, chunkText: item.chunkText }));
    });
    executeRawUnsafe.mockResolvedValue(0);

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html; charset=utf-8' },
      text: async () => makeHtml('<h1>SDK</h1><pre><code>const x = 1;</code></pre><p>Use it.</p>'),
    })) as any;
  });

  test('preserves fenced code blocks in stored chunks', async () => {
    const { ingestDevWixArticles } = await import('../src/backend/devWixDocs/ingest');
    const result = await ingestDevWixArticles({ startUrl: 'https://dev.wix.com/docs/sdk', limitPages: 1, force: true });

    expect(result.stored).toBe(1);
    expect(knowledgeChunkCreateMany).toHaveBeenCalled();
    const firstChunk = chunksState[0]?.chunkText ?? '';
    expect(firstChunk).toContain('```');
    expect(firstChunk).toContain('const x = 1;');
    expect(docsState[0]?.documentStatus).toBe('ready');
  });

  test('unchanged normalized markdown does not trigger rebuild or re-embed', async () => {
    const html = makeHtml('<h1>SDK</h1><p>Stable text.</p>');
    const markdown = htmlToMarkdown(html).markdown;
    docsState = [{ ...docsState[0], contentHash: hashText(markdown), documentStatus: 'ready' }];
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html' },
      text: async () => html,
    })) as any;

    const { ingestDevWixArticles } = await import('../src/backend/devWixDocs/ingest');
    const result = await ingestDevWixArticles({ startUrl: 'https://dev.wix.com/docs/sdk', limitPages: 1, force: true });

    expect(result.skippedUnchanged).toBe(1);
    expect(knowledgeChunkDeleteMany).not.toHaveBeenCalled();
    expect(knowledgeChunkCreateMany).not.toHaveBeenCalled();
    expect(embedText).not.toHaveBeenCalled();
  });

  test('changed markdown rebuilds chunks and refreshes embeddings', async () => {
    docsState = [{ ...docsState[0], contentHash: 'old-hash', documentStatus: 'ready' }];
    chunksState = [{ id: 'chunk-old', documentId: 'doc-1', chunkIndex: 0, chunkText: 'old', tokenCount: 1, textHash: 'old' }];

    const { ingestDevWixArticles } = await import('../src/backend/devWixDocs/ingest');
    const result = await ingestDevWixArticles({ startUrl: 'https://dev.wix.com/docs/sdk', limitPages: 1, force: true });

    expect(result.stored).toBe(1);
    expect(knowledgeChunkDeleteMany).toHaveBeenCalled();
    expect(knowledgeChunkCreateMany).toHaveBeenCalled();
    expect(embedText).toHaveBeenCalled();
    expect(executeRawUnsafe).toHaveBeenCalled();
    expect(docsState[0]?.documentStatus).toBe('ready');
    expect(docsState[0]?.embeddedAt).toBeInstanceOf(Date);
  });

  test('failed fetch records failed status', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      headers: { get: () => 'text/html' },
      text: async () => '',
    })) as any;

    const { ingestDevWixArticles } = await import('../src/backend/devWixDocs/ingest');
    await ingestDevWixArticles({ startUrl: 'https://dev.wix.com/docs/sdk', limitPages: 1, force: true });

    expect(docsState[0]?.documentStatus).toBe('failed');
    expect(docsState[0]?.lastError).toBe('http_500');
  });

  test('404 invalidates document as deleted', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 404,
      headers: { get: () => 'text/html' },
      text: async () => '',
    })) as any;

    const { ingestDevWixArticles } = await import('../src/backend/devWixDocs/ingest');
    await ingestDevWixArticles({ startUrl: 'https://dev.wix.com/docs/sdk', limitPages: 1, force: true });

    expect(knowledgeChunkDeleteMany).toHaveBeenCalled();
    expect(docsState[0]?.documentStatus).toBe('deleted');
    expect(docsState[0]?.lastError).toBe('http_404');
  });

  test('warning mode reduces ingest intensity at >=70% pressure', async () => {
    process.env.BOTCOW_DEV_WIX_EMBEDDING_BUDGET_LIMIT = '10';
    process.env.BOTCOW_DEV_WIX_DB_BUDGET_LIMIT = '10';
    chunksState = Array.from({ length: 7 }, (_, index) => ({
      id: `seed-${index}`,
      documentId: 'seed-doc',
      chunkIndex: index,
      chunkText: `seed-${index}`,
      tokenCount: 10,
      textHash: `seed-${index}`,
    }));

    const { ingestDevWixArticles } = await import('../src/backend/devWixDocs/ingest');
    const result = await ingestDevWixArticles({
      startUrl: 'https://dev.wix.com/docs/sdk',
      limitPages: 1,
      force: true,
      maxEmbeddings: 20,
      maxChunksPerPage: 12,
      chunkTokens: 800,
      overlapTokens: 80,
    });

    expect(result.budgetMode).toBe('warning');
    expect(result.embeddingPressureRatio).toBe(0.7);
    expect(result.dbPressureRatio).toBe(0.7);
    expect(result.maxEmbeddings).toBe(10);
    expect(result.maxChunksPerPage).toBe(6);
    expect(result.chunkTokens).toBe(600);
    expect(result.overlapTokens).toBe(40);
  });

  test('aggressive mode stops new ingest at >=90% pressure', async () => {
    process.env.BOTCOW_DEV_WIX_EMBEDDING_BUDGET_LIMIT = '10';
    process.env.BOTCOW_DEV_WIX_DB_BUDGET_LIMIT = '10';
    chunksState = Array.from({ length: 9 }, (_, index) => ({
      id: `seed-${index}`,
      documentId: 'seed-doc',
      chunkIndex: index,
      chunkText: `seed-${index}`,
      tokenCount: 10,
      textHash: `seed-${index}`,
    }));

    const { ingestDevWixArticles } = await import('../src/backend/devWixDocs/ingest');
    const result = await ingestDevWixArticles({ startUrl: 'https://dev.wix.com/docs/sdk', limitPages: 1, force: true });

    expect(result.budgetMode).toBe('aggressive');
    expect(result.stoppedReason).toBe('budget_aggressive_stop');
    expect(result.budgetHit).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(embedText).not.toHaveBeenCalled();
  });

  test('logs required ingest fields for processed document', async () => {
    const { ingestDevWixArticles } = await import('../src/backend/devWixDocs/ingest');
    const result = await ingestDevWixArticles({ startUrl: 'https://dev.wix.com/docs/sdk', limitPages: 1, force: true });

    expect(result.jobId).toBe('job-1');

    expect(logInfo).toHaveBeenCalledWith(
      'dev_wix_ingest_started',
      expect.objectContaining({
        sourceKey: 'wix_docs_public',
        jobId: 'job-1',
      }),
    );

    expect(logInfo).toHaveBeenCalledWith(
      'dev_wix_document_fetch_completed',
      expect.objectContaining({
        sourceKey: 'wix_docs_public',
        jobId: 'job-1',
        canonicalUrl: 'https://dev.wix.com/docs/sdk',
        lastHttpStatus: 200,
        httpStatusClass: '2xx',
      }),
    );

    expect(logInfo).toHaveBeenCalledWith(
      'dev_wix_document_hash_computed',
      expect.objectContaining({
        sourceKey: 'wix_docs_public',
        jobId: 'job-1',
        canonicalUrl: 'https://dev.wix.com/docs/sdk',
      }),
    );

    expect(logInfo).toHaveBeenCalledWith(
      'dev_wix_document_chunked',
      expect.objectContaining({
        sourceKey: 'wix_docs_public',
        jobId: 'job-1',
        canonicalUrl: 'https://dev.wix.com/docs/sdk',
      }),
    );

    expect(logInfo).toHaveBeenCalledWith(
      'dev_wix_document_embedded',
      expect.objectContaining({
        sourceKey: 'wix_docs_public',
        jobId: 'job-1',
        canonicalUrl: 'https://dev.wix.com/docs/sdk',
      }),
    );

    expect(logInfo).toHaveBeenCalledWith(
      'dev_wix_document_status_transition',
      expect.objectContaining({
        sourceKey: 'wix_docs_public',
        jobId: 'job-1',
        canonicalUrl: 'https://dev.wix.com/docs/sdk',
      }),
    );

    expect(logInfo).toHaveBeenCalledWith(
      'dev_wix_ingest_completed',
      expect.objectContaining({
        sourceKey: 'wix_docs_public',
        jobId: 'job-1',
      }),
    );
  });
});
