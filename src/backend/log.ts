export async function logEvent(type: string, payload: Record<string, unknown>) {
  // Blob-based logging removed to avoid expensive Blob Advanced Operations on Hobby.
  // Keeping API stable as a no-op; callers can still await it safely.
  return {
    type,
    timestamp: new Date().toISOString(),
    payload,
  };
}
