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
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Wix MCP ${method} failed: ${res.status} ${text}`);
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

export async function wixMcpListTools(): Promise<WixMcpTool[]> {
  // Cache to reduce repeated calls and costs.
  const cached = await kvGetJson<{ tools: WixMcpTool[] }>(TOOLS_LIST_CACHE_KEY);
  if (cached?.tools && Array.isArray(cached.tools)) {
    return cached.tools;
  }

  const result = await postJsonRpc<{ tools?: WixMcpTool[] }>('tools/list');
  const tools = Array.isArray(result?.tools) ? result.tools : [];

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
