import type { Request, Response } from 'express';
import { toolsSchemas, toolsHandlers, type ToolName } from '../tools/index';

/**
 * GET /tools
 * Returns OpenAI-compatible tool schemas.
 */
export function getTools(_req: Request, res: Response) {
  res.json({ tools: toolsSchemas });
}

type ToolCallBody = {
  name: string;
  arguments?: unknown;
};

/**
 * POST /tools/call
 * Executes a tool handler by name.
 * Body: { name: string, arguments?: any }
 */
export async function callTool(req: Request, res: Response) {
  const body = (req.body ?? {}) as ToolCallBody;
  const name = body.name as ToolName;

  if (!name || typeof name !== 'string') {
    res.status(400).json({ ok: false, error: 'Missing tool name' });
    return;
  }

  const handler = toolsHandlers[name];
  if (!handler) {
    res.status(404).json({ ok: false, error: 'Unknown tool', name });
    return;
  }

  try {
    const result = await (handler as (a: unknown) => unknown | Promise<unknown>)(
      body.arguments,
    );
    res.json({ ok: true, result });
  } catch (error) {
    const err = error as Error;
    res.status(500).json({ ok: false, error: err.message ?? String(error) });
  }
}
