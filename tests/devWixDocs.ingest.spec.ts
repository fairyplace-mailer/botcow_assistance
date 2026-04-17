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
  chunkVersion: number;
  chunkIndex: number;
  isActive: boolean;
  chunkText: string;
  tokenCount: number;
  textHash: string;
};

const embedText = jest.fn();
const createOrReuseKnowledgeJob = jest.fn();
const markKnowledgeJobRunning = jest.fn();
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
const knowledgeChunkUpdateMany = jest.fn();
const knowledgeChunkCreateMany = jest.fn();
const knowledgeChunkFindFirst = jest.fn();
const knowledgeChunkFindMany = jest.fn();
const executeRawUnsafe = jest.fn();
const queryRawUnsafe = jest.fn();

jest.mock('../src/backend/log', () => ({
  logEvent: jest.fn().mockResolvedValue(undefined),
  logInfo: (...args: any[]) => logInfo(...args),
  logWarn: (...args: any[]) => logWarn(...args),
}));

jest.mock('../src/backend/openai', () => ({
  embedText: (...args: any[]) => embedText(...args),
}));

jest.mock('../src/backend/knowledgeJobs', () => ({
  createOrReuseKnowledgeJob: (...args: any[]) => createOrReuseKnowledgeJob(...args),
  markKnowledgeJobRunning: (...args: any[]) => markKnowledgeJobRunning(...args),
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
      updateMany: (...args: any[]) => knowledgeChunkUpdateMany(...args),
      createMany: (...args: any[]) => knowledgeChunkCreateMany(...args),
      findFirst: (...args: any[]) => knowledgeChunkFindFirst(...args),
      findMany: (...args: any[]) => knowledgeChunkFindMany(...args),
    },
    $queryRawUnsafe: (...args: any[]) => queryRawUnsafe(...args),
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
    createOrReuseKnowledgeJob.mockResolvedValue({
      job: { id: 'job-1', jobStatus: 'queued', cursor: 'https://dev.wix.com/docs/sdk' },
      reused: false,
    });
    markKnowledgeJobRunning.mockResolvedValue({ id: 'job-1', jobStatus: 'running' });
    finishKnowledgeJob.mockResolvedValue({ id: 'job-1' });

    embedText.mockResolvedValue({ vector: [0.1, 0.2], dims: 2, model: 'text-embedding-3-small' });
    knowledgeSourceFindUnique.mockResolvedValue({ id: 'source-1', sourceKey: 'wix_docs_public' });
    knowledgeDocumentCount.mockImplementation(async () => docsState.filter((x) => x.documentStatus === 'ready').length);
    knowledgeChunkCount.mockImplementation(async (args: any) => {
      const onlyActive = args?.where?.isActive;
      return chunksState.filter((x) => (onlyActive === undefined ? true : x.isActive === onlyActive)).length;
    });
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
    knowledgeChunkUpdateMany.mockImplementation(async (args: any) => {
      const documentId = args?.where?.documentId;
      const onlyActive = args?.where?.isActive;
      for (const item of chunksState) {
        if (item.documentId !== documentId) continue;
        if (onlyActive !== undefined && item.isActive !== onlyActive) continue;
        Object.assign(item, args.data);
      }
      return { count: 0 };
    });
    knowledgeChunkCreateMany.mockImplementation(async (args: any) => {
      for (const row of args.data ?? []) {
        chunksState.push({
          id: `chunk-${chunkSeq++}`,
          documentId: row.documentId,
          chunkVersion: row.chunkVersion ?? 1,
          chunkIndex: row.chunkIndex,
          isActive: row.isActive ?? true,
          chunkText: row.chunkText,
          tokenCount: row.tokenCount,
          textHash: row.textHash,
        });
      }
      return { count: args.data?.length ?? 0 };
    });
    knowledgeChunkFindFirst.mockImplementation(async (args: any) => {
      const documentId = args?.where?.documentId;
      return (
        chunksState
          .filter((item) => item.documentId === documentId)
          .sort((a, b) => (b.chunkVersion - a.chunkVersion) || (b.chunkIndex - a.chunkIndex))[0] ?? null
      );
    });

    knowledgeChunkFindMany.mockImplementation(async (args: any) => {
      const documentId = args?.where?.documentId;
      const chunkVersion = args?.where?.chunkVersion;
      const isActive = args?.where?.isActive;
      return chunksState
        .filter((item) => item.documentId === documentId)
        .filter((item) => (chunkVersion === undefined ? true : item.chunkVersion === chunkVersion))
        .filter((item) => (isActive === undefined ? true : item.isActive === isActive))
        .sort((a, b) => a.chunkIndex - b.chunkIndex)
        .map((item) => ({ id: item.id, chunkText: item.chunkText }));
    });
    executeRawUnsafe.mockResolvedValue(0);
    queryRawUnsafe.mockResolvedValue([]);

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html; charset=utf-8' },
      text: async () => makeHtml('<h1>SDK</h1><pre><code>const x = 1;</code></pre><p>Use it.</p>'),
    })) as any;
  });

  test('does not auto-queue a missing start url outside bootstrap state', async () => {
    docsState = [];

    const { ingestDevWixArticles } = await import('../src/backend/devWixDocs/ingest');
    const result = await ingestDevWixArticles({
      startUrl: 'https://dev.wix.com/docs/velo',
      limitPages: 1,
      force: true,
    });

    expect(result.fetched).toBe(0);
    expect(result.stored).toBe(0);
    expect(knowledgeDocumentCreate).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
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
    expect(knowledgeChunkUpdateMany).not.toHaveBeenCalled();
    expect(knowledgeChunkCreateMany).not.toHaveBeenCalled();
    expect(embedText).not.toHaveBeenCalled();
  });

  test('changed markdown rebuilds chunks and refreshes embeddings', async () => {
    docsState = [{ ...docsState[0], contentHash: 'old-hash', documentStatus: 'ready' }];
    chunksState = [{
      id: 'chunk-old',
      documentId: 'doc-1',
      chunkVersion: 1,
      chunkIndex: 0,
      isActive: true,
      chunkText: 'old',
      tokenCount: 1,
      textHash: 'old',
    }];

    const { ingestDevWixArticles } = await import('../src/backend/devWixDocs/ingest');
    const result = await ingestDevWixArticles({ startUrl: 'https://dev.wix.com/docs/sdk', limitPages: 1, force: true });

    expect(result.stored).toBe(1);
    expect(knowledgeChunkUpdateMany).toHaveBeenCalled();
    expect(chunksState.some((x) => x.id === 'chunk-old' && x.isActive === false)).toBe(true);
    expect(chunksState.some((x) => x.id !== 'chunk-old' && x.isActive === true && x.chunkVersion === 2)).toBe(true);
    expect(knowledgeChunkCreateMany).toHaveBeenCalled();
    expect(embedText).toHaveBeenCalled();
    expect(executeRawUnsafe).toHaveBeenCalled();
    expect(docsState[0]?.documentStatus).toBe('ready');
    expect(docsState[0]?.embeddedAt).toBeInstanceOf(Date);
  });

  test('changed document records explicit lifecycle statuses in order', async () => {
    docsState = [{ ...docsState[0], contentHash: 'old-hash', documentStatus: 'ready' }];

    const { ingestDevWixArticles } = await import('../src/backend/devWixDocs/ingest');
    await ingestDevWixArticles({ startUrl: 'https://dev.wix.com/docs/sdk', limitPages: 1, force: true });

    const transitions = logInfo.mock.calls
      .filter(([event]) => event === 'dev_wix_document_status_transition')
      .map(([, payload]) => payload.documentStatusTo);

    expect(transitions).toEqual(['fetched', 'extracted', 'embedded', 'ready']);
  });

  test('unchanged ready document still records fetched and extracted before returning ready', async () => {
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
    await ingestDevWixArticles({ startUrl: 'https://dev.wix.com/docs/sdk', limitPages: 1, force: true });

    const transitions = logInfo.mock.calls
      .filter(([event]) => event === 'dev_wix_document_status_transition')
      .map(([, payload]) => payload.documentStatusTo);

    expect(transitions).toEqual(['fetched', 'extracted', 'ready']);
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

    expect(knowledgeChunkUpdateMany).toHaveBeenCalled();
    expect(docsState[0]?.documentStatus).toBe('deleted');
    expect(docsState[0]?.lastError).toBe('http_404');
  });

  test('warning mode reduces ingest intensity at >=70% pressure', async () => {
    process.env.BOTCOW_DEV_WIX_EMBEDDING_BUDGET_LIMIT = '10';
    process.env.BOTCOW_DEV_WIX_DB_BUDGET_LIMIT = '10';
    chunksState = Array.from({ length: 7 }, (_, index) => ({
      id: `seed-${index}`,
      documentId: 'seed-doc',
      chunkVersion: 1,
      chunkIndex: index,
      isActive: true,
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
      chunkVersion: 1,
      chunkIndex: index,
      isActive: true,
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
    expect(markKnowledgeJobRunning).toHaveBeenCalledWith('job-1');
    expect(finishKnowledgeJob).toHaveBeenLastCalledWith(
      'job-1',
      expect.objectContaining({
        status: 'paused',
        cursor: 'https://dev.wix.com/docs/sdk',
      }),
    );
  });

  test('embed budget exhaustion pauses ingest job instead of marking it done', async () => {
    const { ingestDevWixArticles } = await import('../src/backend/devWixDocs/ingest');
    const result = await ingestDevWixArticles({
      startUrl: 'https://dev.wix.com/docs/sdk',
      limitPages: 1,
      force: true,
      maxEmbeddings: 0,
    });

    expect(result.stoppedReason).toBe('embed_budget_exhausted');
    expect(result.budgetHit).toBe(true);
    expect(finishKnowledgeJob).toHaveBeenLastCalledWith(
      'job-1',
      expect.objectContaining({
        status: 'paused',
        cursor: 'https://dev.wix.com/docs/sdk',
      }),
    );
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
  test('external async queue pressure can stop new ingest even when official docs budget is low', async () => {
    process.env.BOTCOW_ASYNC_QUEUE_PRESSURE_RATIO = '0.95';

    const { ingestDevWixArticles } = await import('../src/backend/devWixDocs/ingest');
    const result = await ingestDevWixArticles({ startUrl: 'https://dev.wix.com/docs/sdk', limitPages: 1, force: true });

    expect(result.budgetMode).toBe('aggressive');
    expect(result.stoppedReason).toBe('budget_aggressive_stop');
    expect(result.budgetHit).toBe(true);
    expect(embedText).not.toHaveBeenCalled();

    delete process.env.BOTCOW_ASYNC_QUEUE_PRESSURE_RATIO;
  });

});
