import { NextResponse } from 'next/server';

import { getToolsSchemas } from '@/backend/tools';
import { requireAdminBearerAuth } from '@/backend/auth/adminAuth';

export async function GET(req: Request) {
  const auth = requireAdminBearerAuth(req);
  if (auth) return auth;

  return NextResponse.json({ tools: getToolsSchemas() });
}
