import { NextResponse } from 'next/server'

import { requireAdminBearerAuth } from '../../../../../backend/auth/adminAuth'
import { getDevWixStatusSummary } from '../../../../../backend/devWixDocs/status'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const authError = requireAdminBearerAuth(req)
  if (authError) return authError

  try {
    const result = await getDevWixStatusSummary()
    return NextResponse.json({ ok: true, result })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 })
  }
}
