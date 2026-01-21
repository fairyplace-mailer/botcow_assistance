import crypto from "crypto";

import { Prisma, PrismaClient } from "@prisma/client";

import { embedText } from "@/backend/openai";
import { updateWebChunkVector } from "@/backend/webKb/pgvector";
import { fetchHtml } from "@/backend/webKb/request";
import { chunkTextByTokens } from "@/backend/webKb/text";
import { classifyRefreshIntervalHours, extractMainText } from "@/backend/webKb/transform";

export type IngestWebKbParams = {
  maxPages: number;
  maxDurationMs: number;
  force?: boolean;
};

export async function ingestWebKb(prisma: PrismaClient, params: IngestWebKbParams) {
  const startedAt = Date.now();
  const deadline = startedAt + params.maxDurationMs;

  const now = new Date();

  let pagesConsidered = 0;
  let pagesFetched = 0;
  let pagesUnchanged = 0;
  let pagesUpdated = 0;
  let pagesFailed = 0;
  let chunksWritten = 0;
  let stoppedByTimeout = false;

  // Claim due pages to avoid double-processing.
  const claimed = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const due = await tx.webPage.findMany({
      where: {
        excludedReason: null,
        OR: [{ nextFetchAt: null }, { nextFetchAt: { lte: now } }],
      },
      orderBy: [{ nextFetchAt: "asc" }, { fetchedAt: "asc" }],
      take: params.maxPages,
      select: { id: true },
    });

    if (due.length === 0) return [] as { id: string }[];

    // mark in-progress for 10 minutes
    await tx.webPage.updateMany({
      where: { id: { in: due.map((d) => d.id) } },
      data: { nextFetchAt: new Date(Date.now() + 10 * 60 * 1000) },
    });

    return due;
  });

  for (const row of claimed) {
    pagesConsidered += 1;

    if (Date.now() > deadline) {
      stoppedByTimeout = true;
      break;
    }

    const page = await prisma.webPage.findUnique({
      where: { id: row.id },
      include: { site: true },
    });
    if (!page) continue;

    const refreshIntervalHours =
      page.refreshIntervalHours ?? classifyRefreshIntervalHours(new URL(page.url));

    try {
      const html = await fetchHtml(page.url);
      pagesFetched += 1;

      const text = extractMainText(html);
      const contentHash = crypto.createHash("sha256").update(text).digest("hex");

      if (page.contentHash && page.contentHash === contentHash) {
        pagesUnchanged += 1;
        await prisma.webPage.update({
          where: { id: page.id },
          data: {
            fetchedAt: new Date(),
            lastSeenAt: new Date(),
            contentHash,
            refreshIntervalHours,
            nextFetchAt: new Date(Date.now() + refreshIntervalHours * 60 * 60 * 1000),
          },
        });
        continue;
      }

      const chunks = chunkTextByTokens(text, { chunkTokens: 800, overlapTokens: 120 });

      // Replace all chunks for the page on change.
      await prisma.webChunk.deleteMany({ where: { pageId: page.id } });

      for (let i = 0; i < chunks.length; i++) {
        if (Date.now() > deadline) {
          stoppedByTimeout = true;
          break;
        }

        const chunk = chunks[i]!;
        const emb = await embedText(chunk);
        const vector = emb.vector;
        const embeddingModel = emb.model;
        if (!vector?.length) throw new Error("embedding_empty");

        const created = await prisma.webChunk.create({
          data: {
            pageId: page.id,
            idx: i,
            content: chunk,
            embeddingModel,
          },
          select: { id: true },
        });

        await updateWebChunkVector({
          prisma,
          chunkId: created.id,
          embedding: vector,
          embeddingModel,
        });

        chunksWritten += 1;
      }

      pagesUpdated += 1;

      await prisma.webPage.update({
        where: { id: page.id },
        data: {
          fetchedAt: new Date(),
          lastSeenAt: new Date(),
          contentHash,
          refreshIntervalHours,
          nextFetchAt: new Date(Date.now() + refreshIntervalHours * 60 * 60 * 1000),
        },
      });
    } catch (e) {
      pagesFailed += 1;
      // backoff 30 minutes on errors
      await prisma.webPage.update({
        where: { id: row.id },
        data: { nextFetchAt: new Date(Date.now() + 30 * 60 * 1000) },
      });
    }
  }

  console.log(
    `[web-kb] ${JSON.stringify({
      run: "ingest",
      pagesConsidered,
      pagesFetched,
      pagesUnchanged,
      pagesUpdated,
      pagesFailed,
      chunksWritten,
      stoppedByTimeout,
      durationMs: Date.now() - startedAt,
    })}`,
  );

  return {
    pagesConsidered,
    pagesFetched,
    pagesUnchanged,
    pagesUpdated,
    pagesFailed,
    chunksWritten,
    stoppedByTimeout,
  };
}
