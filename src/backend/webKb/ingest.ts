import { Prisma, PrismaClient } from "@prisma/client";

import { embedText } from "@/backend/openai";
import { updateWebChunkVector } from "@/backend/webKb/pgvector";
import { fetchHtml } from "@/backend/webKb/request";
import { chunkTextByTokens } from "@/backend/webKb/text";
import {
  classifyRefreshIntervalHours,
  extractMainText,
  sha256Hex,
} from "@/backend/webKb/transform";

export type IngestWebKbParams = {
  maxPages: number;
  maxDurationMs?: number;
  force?: boolean;
};

export type IngestWebKbResult = {
  pagesConsidered: number;
  pagesFetched: number;
  pagesUnchanged: number;
  pagesUpdated: number;
  pagesFailed: number;
  chunksWritten: number;
  stoppedByTimeout: boolean;
};

function isPast(d: Date, now: Date) {
  return d.getTime() <= now.getTime();
}

export async function ingestWebKb(prisma: PrismaClient, params: IngestWebKbParams) {
  const startedAt = Date.now();
  const maxDurationMs = params.maxDurationMs ?? 70_000;

  const res: IngestWebKbResult = {
    pagesConsidered: 0,
    pagesFetched: 0,
    pagesUnchanged: 0,
    pagesUpdated: 0,
    pagesFailed: 0,
    chunksWritten: 0,
    stoppedByTimeout: false,
  };

  const now = new Date();

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

    const ids = due.map((p) => p.id);
    if (ids.length === 0) return [] as string[];

    await tx.webPage.updateMany({
      where: { id: { in: ids } },
      data: { nextFetchAt: new Date(Date.now() + 10 * 60_000) },
    });

    return ids;
  });

  if (claimed.length === 0) {
    return res;
  }

  const pages = await prisma.webPage.findMany({
    where: { id: { in: claimed } },
    include: { site: true },
  });

  for (const page of pages) {
    if (Date.now() - startedAt > maxDurationMs) {
      res.stoppedByTimeout = true;
      break;
    }

    res.pagesConsidered += 1;

    const refreshIntervalHours =
      page.refreshIntervalHours ?? classifyRefreshIntervalHours(page.url);

    // If not forced and page is not due (should be rare since we claim due pages), skip.
    if (!params.force && page.nextFetchAt && !isPast(page.nextFetchAt, now)) {
      res.pagesUnchanged += 1;
      continue;
    }

    try {
      const html = await fetchHtml(page.url);
      res.pagesFetched += 1;

      const extracted = extractMainText(html);
      const contentHash = sha256Hex(extracted.text);

      const unchanged = page.contentHash && page.contentHash === contentHash;

      if (unchanged) {
        res.pagesUnchanged += 1;
        await prisma.webPage.update({
          where: { id: page.id },
          data: {
            fetchedAt: now,
            lastSeenAt: now,
            contentHash,
            refreshIntervalHours,
            nextFetchAt: new Date(now.getTime() + refreshIntervalHours * 3600_000),
          },
        });
        continue;
      }

      // Rebuild chunks.
      await prisma.webChunk.deleteMany({ where: { pageId: page.id } });

      const chunks = chunkTextByTokens(extracted.text, {
        chunkTokens: 800,
        overlapTokens: 120,
      });

      let chunkIndex = 0;
      for (const chunk of chunks) {
        if (Date.now() - startedAt > maxDurationMs) {
          res.stoppedByTimeout = true;
          break;
        }

        const emb = await embedText(chunk);

        const created = await prisma.webChunk.create({
          data: {
            pageId: page.id,
            chunkIndex,
            content: chunk,
            embeddingModel: emb.model,
          },
        });

        await updateWebChunkVector({
          prisma,
          chunkId: created.id,
          embedding: emb.vector,
          embeddingModel: emb.model,
        });

        res.chunksWritten += 1;
        chunkIndex += 1;
      }

      res.pagesUpdated += 1;

      await prisma.webPage.update({
        where: { id: page.id },
        data: {
          fetchedAt: now,
          lastSeenAt: now,
          contentHash,
          refreshIntervalHours,
          nextFetchAt: new Date(now.getTime() + refreshIntervalHours * 3600_000),
        },
      });
    } catch (e) {
      res.pagesFailed += 1;
      // Backoff 30 minutes on failure
      await prisma.webPage.update({
        where: { id: page.id },
        data: { nextFetchAt: new Date(Date.now() + 30 * 60_000) },
      });
      // eslint-disable-next-line no-console
      console.warn("[web-kb] ingest page failed", page.url, e);
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    "[web-kb]",
    JSON.stringify({
      run: "ingest",
      ...res,
      maxPages: params.maxPages,
      maxDurationMs,
    })
  );

  return res;
}
