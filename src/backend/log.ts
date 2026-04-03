type LogPayload = Record<string, unknown>;

export type RunEvent = {
  event: string;
  timestamp: string;
  payload: LogPayload;
};

const MAX_RECENT_RUN_EVENTS = 20;
const runBuffers = new Map<string, RunEvent[]>();

function normalizePayload(payload: LogPayload): LogPayload {
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [key, value === undefined ? null : value]),
  );
}

function getRunKey(payload: LogPayload): string | null {
  const traceId = payload.traceId;
  if (typeof traceId === 'string' && traceId) {
    return traceId;
  }

  const userTurnId = payload.userTurnId;
  if (typeof userTurnId === 'string' && userTurnId) {
    return userTurnId;
  }

  return null;
}

function pushRunEvent(runKey: string, event: RunEvent) {
  const items = runBuffers.get(runKey) ?? [];
  items.push(event);

  if (items.length > MAX_RECENT_RUN_EVENTS) {
    items.splice(0, items.length - MAX_RECENT_RUN_EVENTS);
  }

  runBuffers.set(runKey, items);
}

export function getRecentRunEvents(runKey?: string): RunEvent[] {
  if (!runKey) {
    return Array.from(runBuffers.values()).flat();
  }

  return [...(runBuffers.get(runKey) ?? [])];
}

export function clearRecentRunEvents(runKey?: string) {
  if (!runKey) {
    runBuffers.clear();
    return;
  }

  runBuffers.delete(runKey);
}

export async function logEvent(event: string, payload: LogPayload) {
  const normalizedPayload = normalizePayload(payload);
  const entry: RunEvent = {
    event,
    timestamp: new Date().toISOString(),
    payload: normalizedPayload,
  };

  const runKey = getRunKey(normalizedPayload);
  if (runKey) {
    pushRunEvent(runKey, entry);
  }

  const line = {
    level: 'info',
    ...entry,
  };

  console.info(JSON.stringify(line));
  return entry;
}

export async function logInfo(event: string, payload: LogPayload) {
  return logEvent(event, payload);
}

export async function logWarn(event: string, payload: LogPayload) {
  const normalizedPayload = normalizePayload(payload);
  const entry: RunEvent = {
    event,
    timestamp: new Date().toISOString(),
    payload: normalizedPayload,
  };

  const runKey = getRunKey(normalizedPayload);
  if (runKey) {
    pushRunEvent(runKey, entry);
  }

  console.warn(
    JSON.stringify({
      level: 'warn',
      ...entry,
    }),
  );

  return entry;
}
