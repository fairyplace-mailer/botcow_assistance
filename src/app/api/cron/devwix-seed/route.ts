import { NextResponse } from 'next/server';

import { requireCronSecret } from '../../../../backend/cronAuth';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const authResp = requireCronSecret(req);
  if (authResp) return authResp;

  return NextResponse.json(
    {
      ok: false,
      error: {
        code: 'disabled',
        message: 'Cron-driven seed ingest is disabled. Use an event-driven ingest trigger only.',
      },
    },
    { status: 410 },
  );
}
