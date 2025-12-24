import { appendToBlob } from "./blob-util";

export async function logEvent(type: string, payload: Record<string, unknown>) {
  const now = new Date();
  const line = JSON.stringify({
    type,
    timestamp: now.toISOString(),
    payload,
  });

  const path = "logs/current.jsonl";

  // NOTE: Blob log rotation/cleanup via list/delete is intentionally not used in runtime
  // to avoid expensive Advanced Operations on Hobby.
  await appendToBlob(path, line);

  return { path };
}
