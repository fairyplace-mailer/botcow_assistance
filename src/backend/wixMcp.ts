import { kvGetJson, kvSetJson } from './kv';

const WIX_MCP_ENDPOINT = 'https://dev.wix.com/_api/mcp';

export type WixMcpTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

type JsonRpcSuccess<T> = { jsonrpc: '2.0'; id: string | number | null; result: T };
type JsonRpcError = {
  jsonrpc: '2.0';
  id: string | number | null;
  error: { code?: number; message?: string; data?: unknown };
};

type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcError;

function isJsonRpcError<T>(v: JsonRpcResponse<T>): v is JsonRpcError {
  return typeof (v as any)?.error === 'object' && (v as any).error !== null;
}

function makeId() {
  // cheap unique-ish id to help with debugging
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function readTextSafe(res: Response) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

async function postJsonRpc<T>(method: string, params?: unknown): Promise<T> {
  const body = {
    jsonrpc: '2.0',
    id: makeId(),
    method,
    ...(params !== undefined ? { params } : {}),
  };

  const res = await fetch(WIX_MCP_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Helps some edge setups to not content-negotiate into HTML.
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  // NOTE: In the wild this endpoint sometimes responds with HTML (Next.js) even for POST.
  // We keep a short snippet to ease debugging.
  const contentType = res.headers.get('content-type') || '';

  if (!res.ok) {
    const text = await readTextSafe(res);
    const snippet = text.slice(0, 500);
    throw new Error(
      `Wix MCP ${method} failed: ${res.status} content-type=${contentType} body=${snippet}`,
    );
  }

  if (!contentType.includes('application/json')) {
    const text = await readTextSafe(res);
    const snippet = text.slice(0, 500);
    throw new Error(
      `Wix MCP ${method} invalid response content-type=${contentType} body=${snippet}`,
    );
  }

  const data = (await res.json()) as JsonRpcResponse<T>;
  if (isJsonRpcError(data)) {
    const msg = data.error?.message ?? 'Unknown JSON-RPC error';
    throw new Error(`Wix MCP ${method} error: ${msg}`);
  }

  return (data as JsonRpcSuccess<T>).result;
}

const TOOLS_LIST_CACHE_KEY = 'wix:mcp:tools:list:v1';
const TOOLS_LIST_TTL_SECONDS = 6 * 60 * 60; // 6h

function normalizeToolsListPayload(payload: unknown): WixMcpTool[] {
  const resultTools = (payload as any)?.tools;
  if (Array.isArray(resultTools)) return resultTools;
  if (Array.isArray(payload)) return payload as WixMcpTool[];
  return [];
}

async function tryListToolsViaToolsList(): Promise<WixMcpTool[] | null> {
  try {
    const result = await postJsonRpc<unknown>('tools/list');
    return normalizeToolsListPayload(result);
  } catch {
    return null;
  }
}

async function tryListToolsViaToolsCall(): Promise<WixMcpTool[] | null> {
  // Some MCP implementations expose listing as a tool rather than a JSON-RPC method.
  // We try common variants. If none exist, we return null.
  const candidates = ['ListTools', 'ToolsList', 'tools/list'];
  for (const toolName of candidates) {
    try {
      const result = await postJsonRpc<unknown>('tools/call', { name: toolName, arguments: {} });
      const tools = normalizeToolsListPayload(result);
      if (tools.length) return tools;
    } catch {
      // keep trying
    }
  }
  return null;
}

export async function wixMcpListTools(): Promise<WixMcpTool[]> {
  // Cache to reduce repeated calls and costs.
  const cached = await kvGetJson<{ tools: WixMcpTool[] }>(TOOLS_LIST_CACHE_KEY);
  if (cached?.tools && Array.isArray(cached.tools)) {
    return cached.tools;
  }

  const tools =
    (await tryListToolsViaToolsList()) ?? (await tryListToolsViaToolsCall()) ?? ([] as WixMcpTool[]);

  await kvSetJson(TOOLS_LIST_CACHE_KEY, { tools }, { exSeconds: TOOLS_LIST_TTL_SECONDS });

  return tools;
}

export async function wixMcpCallTool<T = unknown>(name: string, args?: unknown): Promise<T> {
  // Keep the contract flexible: different MCP servers use slightly different param shapes.
  const params = { name, arguments: args ?? {} };
  return postJsonRpc<T>('tools/call', params);
}

function stableStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function makeCacheKey(prefix: string, payload: unknown) {
  return `wix:mcp:${prefix}:${Buffer.from(stableStringify(payload)).toString('base64')}`;
}

export async function wixMcpCachedCall<T = unknown>(opts: {
  cachePrefix: string;
  cacheTtlSeconds: number;
  toolName: string;
  toolArgs: unknown;
}): Promise<T> {
  const key = makeCacheKey(opts.cachePrefix, opts.toolArgs);
  const cached = await kvGetJson<{ result: T }>(key);
  if (cached && Object.prototype.hasOwnProperty.call(cached, 'result')) {
    return cached.result;
  }

  const result = await wixMcpCallTool<T>(opts.toolName, opts.toolArgs);
  await kvSetJson(key, { result }, { exSeconds: opts.cacheTtlSeconds });
  return result;
}
