import { NextResponse } from 'next/server';

import { requireCronSecret } from '../../../../backend/cronAuth';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const authResp = requireCronSecret(req);
  if (authResp) return authResp;

  return NextResponse.json(
    {
      ok: false,
      error: 'Blind cron ingest is disabled. Use the admin ingest route as the event-driven trigger.',
    },
    { status: 410 },
  );
}
