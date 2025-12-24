import { createClient } from '@vercel/kv';

/**
 * KV client (Upstash Redis via Vercel Marketplace).
 *
 * IMPORTANT:
 * Next.js may evaluate app route modules during `next build` ("Collecting page data").
 * To keep builds deterministic and not dependent on runtime secrets,
 * we must NOT throw on missing env at module-evaluation time.
 *
 * Requires at runtime:
 * - KV_REST_API_URL
 * - KV_REST_API_TOKEN
 */

let _kv: ReturnType<typeof createClient> | null = null;

export function getKvClient() {
  if (_kv) return _kv;

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url) {
    throw new Error('KV_REST_API_URL is not set');
  }

  if (!token) {
    throw new Error('KV_REST_API_TOKEN is not set');
  }

  _kv = createClient({ url, token });
  return _kv;
}

export async function kvGetJson<T>(key: string): Promise<T | null> {
  const kv = getKvClient();
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
  const kv = getKvClient();

  if (opts?.exSeconds && opts.exSeconds > 0) {
    await kv.set(key, value, { ex: opts.exSeconds });
    return;
  }

  await kv.set(key, value);
}
