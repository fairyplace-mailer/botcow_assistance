import { appendToBlob, cleanupLogs } from "./blob-util";

export async function logEvent(
  type: string,
  payload: Record<string, unknown>
) {
  const now = new Date();
  const line = JSON.stringify({
    type,
    timestamp: now.toISOString(),
    payload,
  });

  const path = "logs/current.jsonl";

  // 1. append
  await appendToBlob(path, line);

  // 2. cleanup: сохраняем только current.jsonl
  await cleanupLogs("logs/", [path]);

  return { path };
}
