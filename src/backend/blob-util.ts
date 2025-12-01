import { list, del, put } from "@vercel/blob";

const token = process.env.BLOB_READ_WRITE_TOKEN as string;

if (!token) {
  throw new Error("BLOB_READ_WRITE_TOKEN is not set");
}

/**
 * Append data to a blob file (JSON Lines).
 * If blob doesn't exist — it will be created.
 */
export async function appendToBlob(path: string, content: string) {
  // Read existing blob (if exists)
  let existing = "";
  try {
    const res = await fetch(
      `https://api.vercel.com/v2/blobs/${encodeURIComponent(path)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (res.ok) {
      existing = await res.text();
    }
  } catch (_) {}

  const newContent = existing + content + "\n";

  await put(path, newContent, {
    access: "private",
    token,
  });
}

/**
 * Delete all blobs under prefix except whitelist.
 */
export async function cleanupLogs(prefix: string, whitelist: string[]) {
  const res = await list({
    prefix,
    token,
  });

  for (const item of res.blobs) {
    if (!whitelist.includes(item.pathname)) {
      await del(item.pathname, { token });
    }
  }
}
