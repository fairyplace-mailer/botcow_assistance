import { createClient } from '@vercel/kv';

/**
 * KV client (Upstash Redis via Vercel Marketplace).
 *
 * Requires:
 * - KV_REST_API_URL
 * - KV_REST_API_TOKEN
 */
const url = process.env.KV_REST_API_URL;
const token = process.env.KV_REST_API_TOKEN;

if (!url) {
  throw new Error('KV_REST_API_URL is not set');
}

if (!token) {
  throw new Error('KV_REST_API_TOKEN is not set');
}

export const kv = createClient({ url, token });

export async function kvGetJson<T>(key: string): Promise<T | null> {
  const v = await kv.get(key);
  if (v == null) return null;

  // @vercel/kv returns JSON values as objects when set via json/set, but
  // may return strings if stored as plain text.
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }

  return v as T;
}

export async function kvSetJson(
  key: string,
  value: unknown,
  opts?: { exSeconds?: number },
): Promise<void> {
  if (opts?.exSeconds && opts.exSeconds > 0) {
    await kv.set(key, value, { ex: opts.exSeconds });
    return;
  }

  await kv.set(key, value);
}
