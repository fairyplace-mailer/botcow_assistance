import { NextResponse } from 'next/server';

import { handleToolCall } from '../../../backend/tools.js';
import { requireAdminBearerAuth } from '../../../backend/auth/adminAuth.js';

export async function POST(req: Request) {
  const auth = requireAdminBearerAuth(req);
  if (auth) return auth;

  const { name, arguments: args } = await req.json();

  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'Invalid tool name' }, { status: 400 });
  }

  try {
    const result = await handleToolCall(name, args ?? {});
    return NextResponse.json({ ok: true, result });
  } catch (error: any) {
    const message = typeof error?.message === 'string' ? error.message : 'Tool execution failed';

    // Unknown tool is a client error
    const status = /^Unknown tool:/.test(message) ? 404 : 500;

    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
