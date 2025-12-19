import { NextResponse } from "next/server";

import { toolHandlers } from "@/backend/tools";

export async function POST(req: Request) {
  const { name, arguments: args } = await req.json();

  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "Invalid tool name" }, { status: 400 });
  }

  const handler = (toolHandlers as Record<string, unknown>)[name];
  if (typeof handler !== "function") {
    return NextResponse.json({ error: `Unknown tool: ${name}` }, { status: 404 });
  }

  try {
    const result = await (handler as (a: any) => Promise<any>)(args ?? {});
    return NextResponse.json({ ok: true, result });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Tool execution failed" },
      { status: 500 },
    );
  }
}
