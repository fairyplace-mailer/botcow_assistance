import { saveLog } from './blob';

export async function logEvent(type: string, payload: Record<string, unknown>) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const path = `logs/${date}/${type}-${now.getTime()}.json`;

  const data = {
    type,
    timestamp: now.toISOString(),
    payload,
  };

  await saveLog(path, JSON.stringify(data));
  return { path };
}
