import { del, put, list } from '@vercel/blob';

export type PutMarkdownResult = {
  blobPath: string;
};

export type ListDevWixBlobsResult = {
  keys: string[];
  cursor?: string;
  hasMore: boolean;
};

function safeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 180);
}

export function blobPathForDevWixUrl(url: string): string {
  // Stable & readable path; includes a small hash to reduce collision chance.
  let pathname = '';
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }

  // lightweight deterministic hash
  let h = 2166136261;
  for (let i = 0; i < url.length; i += 1) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hex = (h >>> 0).toString(16);

  const slug = safeSlug(pathname);
  return `devwix/${slug || 'doc'}.${hex}.md`;
}

export async function putDevWixMarkdown(url: string, markdown: string): Promise<PutMarkdownResult> {
  const path = blobPathForDevWixUrl(url);
  // Use addRandomSuffix: false to keep the path stable.
  const res = await put(path, markdown, {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'text/markdown; charset=utf-8',
  });

  // Vercel Blob returns url/pathname; we store pathname-like key.
  const blobPath = (res as any).pathname ?? path;
  return { blobPath };
}

export async function deleteMarkdownBlob(blobPath: string): Promise<void> {
  await del(blobPath);
}

export async function listDevWixBlobs(opts?: {
  cursor?: string;
  limit?: number;
}): Promise<ListDevWixBlobsResult> {
  const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 1000);
  const res = await list({
    prefix: 'devwix/',
    cursor: opts?.cursor,
    limit,
  } as any);

  const blobs: any[] = (res as any).blobs ?? [];
  const keys: string[] = blobs
    .map((b) => (b as any).pathname ?? (b as any).key ?? (b as any).url)
    .filter(Boolean);

  return {
    keys,
    cursor: (res as any).cursor,
    hasMore: Boolean((res as any).hasMore),
  };
}
