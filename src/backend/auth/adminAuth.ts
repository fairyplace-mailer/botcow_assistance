import { NextResponse } from 'next/server';

export function requireAdminBearerAuth(req: Request): NextResponse | null {
  const expected = process.env.BOTCOW_ADMIN_TOKEN;

  if (!expected) {
    // Fail closed: if token isn't configured, tools endpoints must not be usable.
    return NextResponse.json(
      { ok: false, error: 'BOTCOW_ADMIN_TOKEN is not configured' },
      { status: 500 },
    );
  }

  const header = req.headers.get('authorization');
  if (!header || typeof header !== 'string') {
    return NextResponse.json(
      { ok: false, error: 'Missing Authorization header' },
      { status: 401 },
    );
  }

  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) {
    return NextResponse.json(
      { ok: false, error: 'Invalid Authorization header format' },
      { status: 401 },
    );
  }

  const token = m[1];
  if (token !== expected) {
    return NextResponse.json(
      { ok: false, error: 'Invalid token' },
      { status: 401 },
    );
  }

  return null;
}
