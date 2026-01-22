import { NextResponse } from 'next/server';

/**
 * Vercel Cron hits endpoints as plain HTTP requests. We protect them with a shared secret.
 *
 * Expected header:
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Dev-only convenience:
 *   In non-production environments we also allow passing the secret via query param:
 *     ?token=<CRON_SECRET>
 *   This makes it possible to trigger cron endpoints from a browser during preview/testing.
 */
export function requireCronSecret(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Fail-closed: if secret isn't configured, don't allow cron endpoints to run.
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET is not configured' },
      { status: 500 },
    );
  }

  const auth = req.headers.get('authorization') ?? '';
  if (auth === `Bearer ${secret}`) return null;

  // Dev-only fallback for preview/testing.
  if (process.env.NODE_ENV !== 'production') {
    try {
      const url = new URL(req.url);
      const token = url.searchParams.get('token');
      if (token && token === secret) return null;
    } catch {
      // ignore
    }
  }

  return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
}
