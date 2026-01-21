// Deprecated: DevWix docs content is stored in Postgres (DocPage.text / DocChunk).
// This module previously stored markdown in Vercel Blob. We keep a minimal API
// to avoid breaking legacy/admin routes, but it is intentionally a no-op.

export type DevWixBlobItem = {
  pathname: string;
  url?: string;
  size?: number;
  uploadedAt?: string;
};

/**
 * @deprecated Blob storage is disabled for DevWix docs.
 */
export async function listDevWixBlobs(): Promise<DevWixBlobItem[]> {
  return [];
}

/**
 * @deprecated Blob storage is disabled for DevWix docs.
 */
export async function deleteMarkdownBlob(_pathname: string): Promise<{ ok: true; skipped: true }> {
  return { ok: true, skipped: true };
}

/**
 * @deprecated Blob storage is disabled for DevWix docs.
 */
export async function putDevWixMarkdown(_url: string, _markdown: string): Promise<never> {
  throw new Error('DevWix Blob storage is disabled: docs are stored in DB (DocPage.text).');
}
