import { list, del, put } from "@vercel/blob";

const token = process.env.BLOB_READ_WRITE_TOKEN as string;

if (!token) {
  throw new Error("BLOB_READ_WRITE_TOKEN is not set");
}

/**
 * Append data to a blob file (JSON Lines).
 * Сейчас: храним только последнее событие (overwrite).
 * Если захотим хранить историю — сделаем настоящий append отдельно.
 */
export async function appendToBlob(path: string, content: string) {
  const newContent = content + "\n";

  await put(path, newContent, {
    access: "public",
    token,
    addRandomSuffix: false,
    allowOverwrite: true, // <-- КЛЮЧЕВОЕ
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
