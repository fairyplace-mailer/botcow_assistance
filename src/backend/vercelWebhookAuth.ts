import crypto from 'crypto';

function timingSafeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function hmacHex(alg: 'sha1' | 'sha256', secret: string, payload: string) {
  return crypto.createHmac(alg, secret).update(payload).digest('hex');
}

/**
 * Verifies Vercel webhook signature.
 *
 * Vercel sends signature header (commonly) as:
 *  - x-vercel-signature: sha1=<hex>, sha256=<hex>
 *
 * We accept any of:
 *  - x-vercel-signature
 *  - x-vercel-signature-sha1
 *  - x-vercel-signature-sha256
 */
export function verifyVercelWebhookSignature(options: {
  rawBody: string;
  headers: Headers;
  secret: string;
}) {
  const sigHeader = options.headers.get('x-vercel-signature');
  const sigSha1 = options.headers.get('x-vercel-signature-sha1');
  const sigSha256 = options.headers.get('x-vercel-signature-sha256');

  const expectedSha1 = hmacHex('sha1', options.secret, options.rawBody);
  const expectedSha256 = hmacHex('sha256', options.secret, options.rawBody);

  const candidates: string[] = [];

  if (sigHeader) {
    // format: "sha1=... , sha256=..." or similar
    const parts = sigHeader
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    for (const p of parts) {
      const [k, v] = p.split('=');
      if (!k || !v) continue;
      if (k === 'sha1') candidates.push(`sha1=${v}`);
      if (k === 'sha256') candidates.push(`sha256=${v}`);
    }
  }

  if (sigSha1) candidates.push(`sha1=${sigSha1.trim()}`);
  if (sigSha256) candidates.push(`sha256=${sigSha256.trim()}`);

  for (const c of candidates) {
    if (c.startsWith('sha1=')) {
      const provided = c.slice('sha1='.length);
      if (provided.length === expectedSha1.length && timingSafeEqual(provided, expectedSha1)) {
        return { ok: true as const, algorithm: 'sha1' as const };
      }
    }
    if (c.startsWith('sha256=')) {
      const provided = c.slice('sha256='.length);
      if (provided.length === expectedSha256.length && timingSafeEqual(provided, expectedSha256)) {
        return { ok: true as const, algorithm: 'sha256' as const };
      }
    }
  }

  return { ok: false as const };
}
