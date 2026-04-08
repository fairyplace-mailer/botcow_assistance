Ниже — **минимальный кодовый пакет**, чтобы bootstrap RAG реально заработал с пустой БД: thin admin-routes, event-driven bootstrap, retrieval вне `route.ts`, без cron как primary ingest. Это соответствует текущему `strong_spec.md`. 

---

## 1. Добавить файлы

```text
docs/rag/dev_wix.seed.txt

prisma/schema.prisma

src/backend/db.ts
src/backend/adminAuth.ts

src/backend/rag/types.ts
src/backend/rag/sourceRegistry.ts
src/backend/rag/seedManifest.ts
src/backend/rag/normalizeUrl.ts
src/backend/rag/hashContent.ts
src/backend/rag/fetchDocument.ts
src/backend/rag/extractWixArticle.ts
src/backend/rag/normalizeMarkdown.ts
src/backend/rag/chunkDocument.ts
src/backend/rag/embedChunks.ts
src/backend/rag/repository.ts
src/backend/rag/bootstrap.ts
src/backend/rag/runBatch.ts
src/backend/rag/retrieve.ts

src/app/api/admin/rag/bootstrap/route.ts
src/app/api/admin/rag/run/route.ts
src/app/api/admin/rag/status/route.ts
```

---

## 2. `package.json` — добавить зависимости

```json
{
  "dependencies": {
    "cheerio": "^1.0.0",
    "turndown": "^7.2.0"
  }
}
```

---

## 3. `prisma/schema.prisma` — добавить модели

Вставь **ниже существующих моделей**.

```prisma
enum KnowledgeSourceStatus {
  ACTIVE
  PAUSED
  DISABLED
}

enum KnowledgeJobKind {
  BOOTSTRAP
  REFRESH
  REINDEX
}

enum KnowledgeJobStatus {
  QUEUED
  RUNNING
  PAUSED
  DONE
  FAILED
}

enum KnowledgeDocumentStatus {
  PENDING
  FETCHED
  EXTRACTED
  EMBEDDED
  READY
  FAILED
  DELETED
}

model KnowledgeSource {
  id               String                @id @default(cuid())
  key              String                @unique
  kind             String
  seedManifestPath String
  scopePrefix      String
  status           KnowledgeSourceStatus @default(ACTIVE)
  createdAt        DateTime              @default(now())
  updatedAt        DateTime              @updatedAt

  jobs       KnowledgeJob[]
  documents  KnowledgeDocument[]
}

model KnowledgeJob {
  id           String             @id @default(cuid())
  sourceId     String
  kind         KnowledgeJobKind
  status       KnowledgeJobStatus @default(QUEUED)
  cursor       String?
  queuedCount  Int                @default(0)
  doneCount    Int                @default(0)
  failedCount  Int                @default(0)
  startedAt    DateTime?
  finishedAt   DateTime?
  createdAt    DateTime           @default(now())
  updatedAt    DateTime           @updatedAt

  source KnowledgeSource @relation(fields: [sourceId], references: [id], onDelete: Cascade)

  @@index([sourceId, status])
}

model KnowledgeDocument {
  id             String                  @id @default(cuid())
  sourceId       String
  originalUrl    String
  canonicalUrl   String
  section        String?
  title          String?
  status         KnowledgeDocumentStatus @default(PENDING)
  contentHash    String?
  markdown       String?
  lastHttpStatus Int?
  lastError      String?
  lastFetchedAt  DateTime?
  lastEmbeddedAt DateTime?
  createdAt      DateTime                @default(now())
  updatedAt      DateTime                @updatedAt

  source KnowledgeSource  @relation(fields: [sourceId], references: [id], onDelete: Cascade)
  chunks KnowledgeChunk[]

  @@unique([sourceId, canonicalUrl])
  @@index([sourceId, status])
}

model KnowledgeChunk {
  id         String   @id @default(cuid())
  documentId String
  chunkIndex Int
  text       String
  tokenCount Int
  textHash   String
  embedding  Json
  isActive   Boolean  @default(true)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  document KnowledgeDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@unique([documentId, chunkIndex])
  @@index([documentId, isActive])
}
```

---

## 4. `docs/rag/dev_wix.seed.txt`

Сюда положи твои `694` URL, **один URL на строку**.

---

## 5. `src/backend/db.ts`

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
```

---

## 6. `src/backend/adminAuth.ts`

```ts
export function assertAdmin(request: Request): void {
  const expected = process.env.BOTCOW_ADMIN_TOKEN;
  const received = request.headers.get("x-admin-token");

  if (!expected) {
    throw new Error("BOTCOW_ADMIN_TOKEN is not configured");
  }

  if (received !== expected) {
    throw new Error("Unauthorized");
  }
}
```

---

## 7. `src/backend/rag/types.ts`

```ts
export const WIX_SOURCE_KEY = "wix_docs_public" as const;

export type RagSourceKey = typeof WIX_SOURCE_KEY;

export interface SeedManifestRecord {
  originalUrl: string;
  canonicalUrl: string;
}

export interface FetchedDocument {
  url: string;
  httpStatus: number;
  contentType: string;
  html: string;
}

export interface ExtractedDocument {
  canonicalUrl: string;
  section: string | null;
  title: string | null;
  markdown: string;
}

export interface ChunkRecord {
  chunkIndex: number;
  text: string;
  tokenCount: number;
  textHash: string;
}

export interface RetrievedChunk {
  documentId: string;
  chunkId: string;
  url: string;
  title: string | null;
  section: string | null;
  chunkIndex: number;
  text: string;
  score: number;
}

export interface BootstrapResult {
  sourceId: string;
  jobId: string;
  createdDocuments: number;
  existingDocuments: number;
  totalSeedUrls: number;
}

export interface RunBatchResult {
  jobId: string;
  processed: number;
  ready: number;
  failed: number;
  deleted: number;
  remaining: number;
  done: boolean;
}
```

---

## 8. `src/backend/rag/sourceRegistry.ts`

```ts
import { WIX_SOURCE_KEY } from "./types";

export const wixDocsSource = {
  key: WIX_SOURCE_KEY,
  kind: "public_http_docs",
  seedManifestPath: "docs/rag/dev_wix.seed.txt",
  scopePrefix: "https://dev.wix.com/docs/",
} as const;
```

---

## 9. `src/backend/rag/normalizeUrl.ts`

```ts
export function normalizeUrl(input: string): string {
  const url = new URL(input.trim());

  url.hash = "";
  url.search = "";

  const normalizedPath = url.pathname.replace(/\/+$/, "");
  url.pathname = normalizedPath || "/";

  return url.toString();
}

export function getSectionFromUrl(url: string): string | null {
  const pathname = new URL(url).pathname;
  const parts = pathname.split("/").filter(Boolean);

  // /docs/api-reference/...
  if (parts.length >= 2 && parts[0] === "docs") {
    return parts[1] ?? null;
  }

  return null;
}

export function assertUrlInScope(url: string, scopePrefix: string): void {
  if (!url.startsWith(scopePrefix)) {
    throw new Error(`Out-of-scope URL: ${url}`);
  }
}
```

---

## 10. `src/backend/rag/seedManifest.ts`

```ts
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeUrl, assertUrlInScope } from "./normalizeUrl";
import type { SeedManifestRecord } from "./types";

export async function readSeedManifest(
  manifestPath: string,
  scopePrefix: string,
): Promise<SeedManifestRecord[]> {
  const abs = path.resolve(process.cwd(), manifestPath);
  const raw = await fs.readFile(abs, "utf8");

  const unique = new Map<string, SeedManifestRecord>();

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const canonicalUrl = normalizeUrl(trimmed);
    assertUrlInScope(canonicalUrl, scopePrefix);

    unique.set(canonicalUrl, {
      originalUrl: trimmed,
      canonicalUrl,
    });
  }

  return Array.from(unique.values()).sort((a, b) =>
    a.canonicalUrl.localeCompare(b.canonicalUrl),
  );
}
```

---

## 11. `src/backend/rag/hashContent.ts`

```ts
import crypto from "node:crypto";

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}
```

---

## 12. `src/backend/rag/fetchDocument.ts`

```ts
import type { FetchedDocument } from "./types";

export async function fetchDocument(url: string): Promise<FetchedDocument> {
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: {
      "user-agent": "BotCow/1.0 knowledge-bootstrap",
      "accept": "text/html,application/xhtml+xml",
    },
    cache: "no-store",
  });

  const contentType = response.headers.get("content-type") ?? "";
  const html = await response.text();

  return {
    url,
    httpStatus: response.status,
    contentType,
    html,
  };
}
```

---

## 13. `src/backend/rag/normalizeMarkdown.ts`

```ts
export function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}
```

---

## 14. `src/backend/rag/extractWixArticle.ts`

```ts
import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { getSectionFromUrl } from "./normalizeUrl";
import { normalizeMarkdown } from "./normalizeMarkdown";
import type { ExtractedDocument } from "./types";

function createTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });

  td.addRule("pre", {
    filter: "pre",
    replacement: (_content, node) => {
      const code = (node.textContent ?? "").trim();
      if (!code) return "\n\n";
      return `\n\n\`\`\`\n${code}\n\`\`\`\n\n`;
    },
  });

  td.addRule("inlineCode", {
    filter(node) {
      return node.nodeName === "CODE" && node.parentNode?.nodeName !== "PRE";
    },
    replacement(content) {
      return `\`${content}\``;
    },
  });

  return td;
}

export function extractWixArticle(
  canonicalUrl: string,
  html: string,
): ExtractedDocument {
  const $ = cheerio.load(html);

  $("script, style, noscript, iframe, header, footer, nav").remove();

  const root =
    $("main article").first().length > 0
      ? $("main article").first()
      : $("article").first().length > 0
        ? $("article").first()
        : $("main").first().length > 0
          ? $("main").first()
          : $("body").first();

  const title =
    $("h1").first().text().trim() ||
    $("title").first().text().trim() ||
    null;

  const td = createTurndown();
  const rawMarkdown = td.turndown(root.html() ?? "");
  const markdown = normalizeMarkdown(rawMarkdown);

  if (!markdown) {
    throw new Error("Extracted markdown is empty");
  }

  return {
    canonicalUrl,
    section: getSectionFromUrl(canonicalUrl),
    title,
    markdown,
  };
}
```

---

## 15. `src/backend/rag/chunkDocument.ts`

````ts
import { sha256 } from "./hashContent";
import type { ChunkRecord } from "./types";

function approxTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function chunkDocument(markdown: string): ChunkRecord[] {
  const lines = markdown.split("\n");
  const chunks: ChunkRecord[] = [];

  const maxTokens = 900;
  const minTokens = 350;

  let current: string[] = [];
  let currentTokens = 0;
  let chunkIndex = 0;
  let insideFence = false;

  const flush = () => {
    const text = current.join("\n").trim();
    if (!text) return;

    chunks.push({
      chunkIndex,
      text,
      tokenCount: approxTokens(text),
      textHash: sha256(text),
    });

    chunkIndex += 1;
    current = [];
    currentTokens = 0;
  };

  for (const line of lines) {
    const lineTokens = approxTokens(line + "\n");
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      insideFence = !insideFence;
    }

    const shouldFlush =
      currentTokens >= minTokens &&
      currentTokens + lineTokens > maxTokens &&
      !insideFence;

    if (shouldFlush) {
      flush();
    }

    current.push(line);
    currentTokens += lineTokens;
  }

  flush();

  return chunks;
}
````

---

## 16. `src/backend/rag/embedChunks.ts`

Создай файл и **подстрой импорт клиента** под твой реальный `src/backend/openai.ts`.

```ts
import OpenAI from "openai";

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (cachedClient) return cachedClient;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}

const EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const client = getClient();
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });

  return response.data.map((item) => item.embedding);
}

export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await embedTexts([text]);
  return vector;
}
```

---

## 17. `src/backend/rag/repository.ts`

```ts
import {
  KnowledgeDocumentStatus,
  KnowledgeJobKind,
  KnowledgeJobStatus,
  KnowledgeSourceStatus,
} from "@prisma/client";
import { db } from "../db";
import { wixDocsSource } from "./sourceRegistry";
import type { ChunkRecord } from "./types";

export async function ensureWixSource() {
  return db.knowledgeSource.upsert({
    where: { key: wixDocsSource.key },
    update: {
      kind: wixDocsSource.kind,
      seedManifestPath: wixDocsSource.seedManifestPath,
      scopePrefix: wixDocsSource.scopePrefix,
      status: KnowledgeSourceStatus.ACTIVE,
    },
    create: {
      key: wixDocsSource.key,
      kind: wixDocsSource.kind,
      seedManifestPath: wixDocsSource.seedManifestPath,
      scopePrefix: wixDocsSource.scopePrefix,
      status: KnowledgeSourceStatus.ACTIVE,
    },
  });
}

export async function createBootstrapJob(sourceId: string) {
  return db.knowledgeJob.create({
    data: {
      sourceId,
      kind: KnowledgeJobKind.BOOTSTRAP,
      status: KnowledgeJobStatus.QUEUED,
    },
  });
}

export async function getLatestOpenJob(sourceId: string) {
  return db.knowledgeJob.findFirst({
    where: {
      sourceId,
      status: { in: [KnowledgeJobStatus.QUEUED, KnowledgeJobStatus.RUNNING, KnowledgeJobStatus.PAUSED] },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function countExistingCanonicalUrls(sourceId: string): Promise<Set<string>> {
  const rows = await db.knowledgeDocument.findMany({
    where: { sourceId },
    select: { canonicalUrl: true },
  });

  return new Set(rows.map((r) => r.canonicalUrl));
}

export async function insertPendingDocuments(
  sourceId: string,
  docs: Array<{ originalUrl: string; canonicalUrl: string; section: string | null }>,
) {
  if (docs.length === 0) return { count: 0 };

  const result = await db.knowledgeDocument.createMany({
    data: docs.map((doc) => ({
      sourceId,
      originalUrl: doc.originalUrl,
      canonicalUrl: doc.canonicalUrl,
      section: doc.section,
      status: KnowledgeDocumentStatus.PENDING,
    })),
    skipDuplicates: true,
  });

  return result;
}

export async function setJobQueuedCount(jobId: string, queuedCount: number) {
  return db.knowledgeJob.update({
    where: { id: jobId },
    data: { queuedCount },
  });
}

export async function startJob(jobId: string) {
  return db.knowledgeJob.update({
    where: { id: jobId },
    data: {
      status: KnowledgeJobStatus.RUNNING,
      startedAt: new Date(),
    },
  });
}

export async function finishJob(jobId: string, status: KnowledgeJobStatus) {
  return db.knowledgeJob.update({
    where: { id: jobId },
    data: {
      status,
      finishedAt: new Date(),
    },
  });
}

export async function getPendingDocuments(sourceId: string, limit: number) {
  return db.knowledgeDocument.findMany({
    where: {
      sourceId,
      status: { in: [KnowledgeDocumentStatus.PENDING, KnowledgeDocumentStatus.FAILED] },
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });
}

export async function getRemainingCount(sourceId: string): Promise<number> {
  return db.knowledgeDocument.count({
    where: {
      sourceId,
      status: { in: [KnowledgeDocumentStatus.PENDING, KnowledgeDocumentStatus.FAILED] },
    },
  });
}

export async function markDeleted(documentId: string, httpStatus: number) {
  return db.$transaction([
    db.knowledgeChunk.updateMany({
      where: { documentId },
      data: { isActive: false },
    }),
    db.knowledgeDocument.update({
      where: { id: documentId },
      data: {
        status: KnowledgeDocumentStatus.DELETED,
        lastHttpStatus: httpStatus,
        lastFetchedAt: new Date(),
        lastError: null,
      },
    }),
  ]);
}

export async function markFailed(documentId: string, httpStatus: number | null, error: string) {
  return db.knowledgeDocument.update({
    where: { id: documentId },
    data: {
      status: KnowledgeDocumentStatus.FAILED,
      lastHttpStatus: httpStatus ?? undefined,
      lastError: error.slice(0, 1000),
      lastFetchedAt: new Date(),
    },
  });
}

export async function markReadyWithChunks(args: {
  documentId: string;
  title: string | null;
  markdown: string;
  contentHash: string;
  httpStatus: number;
  chunks: Array<ChunkRecord & { embedding: number[] }>;
}) {
  const { documentId, title, markdown, contentHash, httpStatus, chunks } = args;

  await db.$transaction(async (tx) => {
    await tx.knowledgeChunk.updateMany({
      where: { documentId },
      data: { isActive: false },
    });

    await tx.knowledgeDocument.update({
      where: { id: documentId },
      data: {
        title,
        markdown,
        contentHash,
        status: KnowledgeDocumentStatus.READY,
        lastHttpStatus: httpStatus,
        lastFetchedAt: new Date(),
        lastEmbeddedAt: new Date(),
        lastError: null,
      },
    });

    if (chunks.length > 0) {
      await tx.knowledgeChunk.createMany({
        data: chunks.map((chunk) => ({
          documentId,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          tokenCount: chunk.tokenCount,
          textHash: chunk.textHash,
          embedding: chunk.embedding,
          isActive: true,
        })),
      });
    }
  });
}

export async function getStatusSnapshot(sourceId: string) {
  const [source, jobs, counts] = await Promise.all([
    db.knowledgeSource.findUnique({ where: { id: sourceId } }),
    db.knowledgeJob.findMany({
      where: { sourceId },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    db.knowledgeDocument.groupBy({
      by: ["status"],
      where: { sourceId },
      _count: { _all: true },
    }),
  ]);

  return { source, jobs, counts };
}
```

---

## 18. `src/backend/rag/bootstrap.ts`

```ts
import { getSectionFromUrl } from "./normalizeUrl";
import { readSeedManifest } from "./seedManifest";
import { wixDocsSource } from "./sourceRegistry";
import {
  ensureWixSource,
  createBootstrapJob,
  countExistingCanonicalUrls,
  insertPendingDocuments,
  setJobQueuedCount,
} from "./repository";
import type { BootstrapResult } from "./types";

export async function bootstrapWixKnowledge(): Promise<BootstrapResult> {
  const source = await ensureWixSource();
  const seedRecords = await readSeedManifest(
    wixDocsSource.seedManifestPath,
    wixDocsSource.scopePrefix,
  );

  const existing = await countExistingCanonicalUrls(source.id);

  const missing = seedRecords
    .filter((record) => !existing.has(record.canonicalUrl))
    .map((record) => ({
      originalUrl: record.originalUrl,
      canonicalUrl: record.canonicalUrl,
      section: getSectionFromUrl(record.canonicalUrl),
    }));

  const createManyResult = await insertPendingDocuments(source.id, missing);
  const job = await createBootstrapJob(source.id);

  const queuedCount = missing.length;
  await setJobQueuedCount(job.id, queuedCount);

  return {
    sourceId: source.id,
    jobId: job.id,
    createdDocuments: createManyResult.count,
    existingDocuments: existing.size,
    totalSeedUrls: seedRecords.length,
  };
}
```

---

## 19. `src/backend/rag/runBatch.ts`

```ts
import { KnowledgeJobStatus } from "@prisma/client";
import { wixDocsSource } from "./sourceRegistry";
import { fetchDocument } from "./fetchDocument";
import { extractWixArticle } from "./extractWixArticle";
import { sha256 } from "./hashContent";
import { chunkDocument } from "./chunkDocument";
import { embedTexts } from "./embedChunks";
import {
  ensureWixSource,
  finishJob,
  getLatestOpenJob,
  getPendingDocuments,
  getRemainingCount,
  markDeleted,
  markFailed,
  markReadyWithChunks,
  startJob,
} from "./repository";
import type { RunBatchResult } from "./types";

export async function runWixKnowledgeBatch(limit = 10): Promise<RunBatchResult> {
  const source = await ensureWixSource();

  let job = await getLatestOpenJob(source.id);
  if (!job) {
    throw new Error("No open knowledge job found. Run bootstrap first.");
  }

  if (job.status !== "RUNNING") {
    job = await startJob(job.id);
  }

  const docs = await getPendingDocuments(source.id, limit);

  let processed = 0;
  let ready = 0;
  let failed = 0;
  let deleted = 0;

  for (const doc of docs) {
    processed += 1;

    try {
      const fetched = await fetchDocument(doc.canonicalUrl);

      if (fetched.httpStatus === 404 || fetched.httpStatus === 410) {
        await markDeleted(doc.id, fetched.httpStatus);
        deleted += 1;
        continue;
      }

      if (fetched.httpStatus < 200 || fetched.httpStatus >= 300) {
        throw new Error(`Unexpected HTTP status ${fetched.httpStatus}`);
      }

      if (!fetched.contentType.includes("text/html")) {
        throw new Error(`Unexpected content type: ${fetched.contentType}`);
      }

      const extracted = extractWixArticle(doc.canonicalUrl, fetched.html);
      const contentHash = sha256(extracted.markdown);

      if (doc.contentHash && doc.contentHash === contentHash && doc.status === "READY") {
        await markReadyWithChunks({
          documentId: doc.id,
          title: extracted.title,
          markdown: extracted.markdown,
          contentHash,
          httpStatus: fetched.httpStatus,
          chunks: [],
        });
        ready += 1;
        continue;
      }

      const chunks = chunkDocument(extracted.markdown);
      const vectors = await embedTexts(chunks.map((chunk) => chunk.text));

      await markReadyWithChunks({
        documentId: doc.id,
        title: extracted.title,
        markdown: extracted.markdown,
        contentHash,
        httpStatus: fetched.httpStatus,
        chunks: chunks.map((chunk, i) => ({
          ...chunk,
          embedding: vectors[i] ?? [],
        })),
      });

      ready += 1;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown document processing error";
      await markFailed(doc.id, null, message);
      failed += 1;
    }
  }

  const remaining = await getRemainingCount(source.id);

  if (remaining === 0) {
    await finishJob(job.id, KnowledgeJobStatus.DONE);
  }

  return {
    jobId: job.id,
    processed,
    ready,
    failed,
    deleted,
    remaining,
    done: remaining === 0,
  };
}
```

---

## 20. `src/backend/rag/retrieve.ts`

```ts
import { db } from "../db";
import { embedQuery } from "./embedChunks";
import { WIX_SOURCE_KEY } from "./types";
import type { RetrievedChunk } from "./types";

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return -1;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? -1 : dot / denom;
}

export async function retrieveWixChunks(
  queryText: string,
  topK = 6,
): Promise<RetrievedChunk[]> {
  const queryVector = await embedQuery(queryText);

  const chunks = await db.knowledgeChunk.findMany({
    where: {
      isActive: true,
      document: {
        status: "READY",
        source: {
          key: WIX_SOURCE_KEY,
        },
      },
    },
    select: {
      id: true,
      chunkIndex: true,
      text: true,
      embedding: true,
      document: {
        select: {
          id: true,
          canonicalUrl: true,
          title: true,
          section: true,
        },
      },
    },
  });

  const scored: RetrievedChunk[] = chunks
    .map((chunk) => {
      const embedding = Array.isArray(chunk.embedding)
        ? (chunk.embedding as number[])
        : [];

      return {
        documentId: chunk.document.id,
        chunkId: chunk.id,
        url: chunk.document.canonicalUrl,
        title: chunk.document.title,
        section: chunk.document.section,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        score: cosineSimilarity(queryVector, embedding),
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored;
}

export async function maybeRetrieveWixChunks(userText: string): Promise<RetrievedChunk[]> {
  const looksLikeWixQuestion =
    /wix|velo|headless|wix app|wix docs|dev\.wix/i.test(userText);

  if (!looksLikeWixQuestion) {
    return [];
  }

  return retrieveWixChunks(userText, 6);
}

export function formatRetrievedChunksForPrompt(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "";

  return chunks
    .map((chunk, index) => {
      return [
        `SOURCE ${index + 1}`,
        `title: ${chunk.title ?? "Untitled"}`,
        `url: ${chunk.url}`,
        `section: ${chunk.section ?? "unknown"}`,
        `chunk_index: ${chunk.chunkIndex}`,
        `content:`,
        chunk.text,
      ].join("\n");
    })
    .join("\n\n---\n\n");
}
```

---

## 21. `src/app/api/admin/rag/bootstrap/route.ts`

```ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/src/backend/adminAuth";
import { bootstrapWixKnowledge } from "@/src/backend/rag/bootstrap";

export async function POST(request: Request) {
  try {
    assertAdmin(request);
    const result = await bootstrapWixKnowledge();
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bootstrap failed";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json(
      { ok: false, error: { message } },
      { status },
    );
  }
}
```

---

## 22. `src/app/api/admin/rag/run/route.ts`

```ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/src/backend/adminAuth";
import { runWixKnowledgeBatch } from "@/src/backend/rag/runBatch";

export async function POST(request: Request) {
  try {
    assertAdmin(request);

    const body = await request.json().catch(() => ({}));
    const limit =
      typeof body.limit === "number" && body.limit > 0 && body.limit <= 25
        ? body.limit
        : 10;

    const result = await runWixKnowledgeBatch(limit);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Run batch failed";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json(
      { ok: false, error: { message } },
      { status },
    );
  }
}
```

---

## 23. `src/app/api/admin/rag/status/route.ts`

```ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/src/backend/adminAuth";
import { ensureWixSource, getStatusSnapshot } from "@/src/backend/rag/repository";

export async function GET(request: Request) {
  try {
    assertAdmin(request);
    const source = await ensureWixSource();
    const result = await getStatusSnapshot(source.id);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Status failed";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json(
      { ok: false, error: { message } },
      { status },
    );
  }
}
```

---

## 24. Патч в `src/backend/assistant.ts`

### Куда вставить

После того как у тебя уже есть:

* собранный `latestUserMessage`
* но **до** финальной сборки prompt/policy input.

### Что вставить

```ts
import {
  maybeRetrieveWixChunks,
  formatRetrievedChunksForPrompt,
} from "@/src/backend/rag/retrieve";
```

И внутри main assistant flow:

```ts
const latestUserText =
  messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n")
    .trim();

const retrievedWixChunks = await maybeRetrieveWixChunks(latestUserText);
const wixKnowledgeBlock = formatRetrievedChunksForPrompt(retrievedWixChunks);
```

Дальше передай `wixKnowledgeBlock` в **существующий prompt layer**, а не в `route.ts`.

Если у тебя prompt builder принимает объект:

```ts
const promptInput = {
  // ...старые поля
  wixKnowledgeBlock,
};
```

Если retrieval ничего не нашёл, `wixKnowledgeBlock === ""`.

---

## 25. Первый запуск

### 1

Установить зависимости:

```bash
npm i cheerio turndown
```

### 2

Применить миграцию:

```bash
npx prisma migrate dev --name add_knowledge_bootstrap
```

### 3

Положить `694` URL в:

```text
docs/rag/dev_wix.seed.txt
```

### 4

Запустить bootstrap:

```bash
curl -X POST http://localhost:3000/api/admin/rag/bootstrap \
  -H "x-admin-token: YOUR_TOKEN"
```

### 5

Прогонять батчи:

```bash
curl -X POST http://localhost:3000/api/admin/rag/run \
  -H "Content-Type: application/json" \
  -H "x-admin-token: YOUR_TOKEN" \
  -d '{"limit":10}'
```

Повторять, пока `done: true`.

### 6

Проверять статус:

```bash
curl http://localhost:3000/api/admin/rag/status \
  -H "x-admin-token: YOUR_TOKEN"
```

---

## 26. Что у тебя получится после этого

После этих патчей механизм уже начнёт работать:

* из `seed.txt` создастся queue;
* страницы начнут скачиваться;
* текст и code examples будут извлекаться;
* markdown будет сохраняться;
* chunks и embeddings будут строиться;
* retrieval начнёт отдавать top-K куски в assistant layer.

---

## 27. Две честные оговорки

1. **`extractWixArticle.ts`** — это минимальный extractor.
   Если у Wix Docs специфическая DOM-структура, потом его надо будет подстроить под реальные селекторы.

2. В этой минимальной версии embeddings хранятся как `Json`, а similarity считается в Node.
   Для bootstrap и первых тысяч chunks этого достаточно. Потом можно перевести на `pgvector`.