import type { NextFunction, Request, Response } from 'express';
import { toolsSchemas, toolsHandlers } from '../tools/index';

function parseBearerToken(header: unknown): string | undefined {
  if (!header || typeof header !== 'string') return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1] : undefined;
}

function requireAdminBearerAuthExpress(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.BOTCOW_ADMIN_TOKEN;

  if (!expected) {
    // Fail closed: if token isn't configured, tools endpoints must not be usable.
    res.status(500).json({ ok: false, error: 'BOTCOW_ADMIN_TOKEN is not configured' });
    return;
  }

  const token = parseBearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json({ ok: false, error: 'Missing or invalid Authorization header' });
    return;
  }

  if (token !== expected) {
    res.status(401).json({ ok: false, error: 'Invalid token' });
    return;
  }

  next();
}

/**
 * GET /tools
 * Returns OpenAI-compatible tool schemas.
 */
export function getTools(req: Request, res: Response) {
  requireAdminBearerAuthExpress(req, res, () => {
    res.json({ tools: toolsSchemas });
  });
}

type ToolCallBody = {
  name: string;
  arguments?: unknown;
};

type ToolName = keyof typeof toolsHandlers;

/**
 * POST /tools/call
 * Executes a tool handler by name.
 * Body: { name: string, arguments?: any }
 */
export async function callTool(req: Request, res: Response) {
  requireAdminBearerAuthExpress(req, res, async () => {
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
  });
}
