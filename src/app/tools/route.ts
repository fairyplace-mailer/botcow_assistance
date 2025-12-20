import { NextResponse } from 'next/server';

import { getToolsSchemas } from '@/backend/tools';

export async function GET() {
  return NextResponse.json({ tools: getToolsSchemas() });
}
