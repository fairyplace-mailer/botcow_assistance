import { NextResponse } from 'next/server';

/**
 * Vercel Cron hits endpoints as plain HTTP requests. We protect them with a shared secret.
 *
 * Expected header:
 *   Authorization: Bearer <CRON_SECRET>
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
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}
