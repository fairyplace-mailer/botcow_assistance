import { NextResponse } from "next/server";

import { toolSchemas } from "@/backend/tools";

export async function GET() {
  return NextResponse.json({ tools: toolSchemas });
}
