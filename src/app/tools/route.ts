import { NextResponse } from 'next/server';

import { getToolsSchemas } from '../../backend/tools.js';
import { requireAdminBearerAuth } from '../../backend/auth/adminAuth.js';

export async function GET(req: Request) {
  const auth = requireAdminBearerAuth(req);
  if (auth) return auth;

  return NextResponse.json({ tools: getToolsSchemas() });
}
