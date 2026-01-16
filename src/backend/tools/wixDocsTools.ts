import { wixMcpCachedCall, wixMcpListTools } from '../wixMcp';

function assertNonEmptyString(name: string, v: unknown): asserts v is string {
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
}

// Conservative TTLs: docs content changes, but not minute-to-minute.
const TTL_SEARCH_SECONDS = 6 * 60 * 60; // 6h
const TTL_ARTICLE_SECONDS = 24 * 60 * 60; // 24h
const TTL_SCHEMA_SECONDS = 24 * 60 * 60; // 24h

export const wixDocsToolsSchemas = [
  {
    type: 'function',
    function: {
      name: 'wix_docs_search',
      description:
        'Search Wix developer documentation (dev.wix.com) via MCP tool SearchSiteApiDocs.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query.' },
          limit: {
            type: 'number',
            description: 'Max items to return (default 5, max 10).',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wix_docs_read_article',
      description:
        'Read full documentation article text from dev.wix.com via MCP tool ReadFullDocsArticle.',
      parameters: {
        type: 'object',
        properties: {
          articleUrl: {
            type: 'string',
            description: 'Full article URL on https://dev.wix.com.',
          },
        },
        required: ['articleUrl'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wix_docs_read_method_schema',
      description:
        'Read full Wix API method schema from dev.wix.com via MCP tool ReadFullDocsMethodSchema.',
      parameters: {
        type: 'object',
        properties: {
          methodId: {
            type: 'string',
            description:
              'Method identifier as expected by Wix MCP server (exact shape depends on server).',
          },
        },
        required: ['methodId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wix_docs_list_mcp_tools',
      description:
        'List available MCP tools on dev.wix.com/_api/mcp (cached). Useful for debugging. Optionally include inputSchema for a specific tool to discover its argument shape without returning full schemas for everything.',
      parameters: {
        type: 'object',
        properties: {
          toolName: {
            type: 'string',
            description:
              'Optional tool name to filter by. If provided, only matching tools are returned.',
          },
          includeInputSchema: {
            type: 'boolean',
            description:
              'If true and toolName is provided, include inputSchema in the result for matching tools.',
          },
        },
      },
    },
  },
] as const;

function clampLimit(limit: unknown) {
  const n = typeof limit === 'number' ? limit : Number(limit);
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(10, Math.trunc(n)));
}

export const wixDocsToolHandlers = {
  async wix_docs_list_mcp_tools(args?: {
    toolName?: string;
    includeInputSchema?: boolean;
  }) {
    const tools = await wixMcpListTools();

    const toolName = args?.toolName?.trim();
    const includeInputSchema = Boolean(args?.includeInputSchema && toolName);

    const filtered = toolName ? tools.filter((t) => t.name === toolName) : tools;

    // Default: minimal data to save tokens.
    const mapped = filtered.map((t) => {
      const base: any = { name: t.name, description: t.description };
      if (includeInputSchema) base.inputSchema = t.inputSchema;
      return base;
    });

    return { tools: mapped };
  },

  async wix_docs_search(args: { query: string; limit?: number }) {
    assertNonEmptyString('query', args?.query);

    const limit = clampLimit(args.limit);

    // We send limit in args to reduce server work & response size if supported.
    const raw = await wixMcpCachedCall<any>({
      cachePrefix: 'docs:search:v1',
      cacheTtlSeconds: TTL_SEARCH_SECONDS,
      toolName: 'SearchSiteApiDocs',
      toolArgs: { query: args.query, limit },
    });

    // We don't assume exact response shape; we still try to keep output small.
    if (Array.isArray(raw)) {
      return { items: raw.slice(0, limit) };
    }

    const items = Array.isArray((raw as any)?.items) ? (raw as any).items : raw;

    if (Array.isArray(items)) {
      return { items: items.slice(0, limit) };
    }

    return raw;
  },

  async wix_docs_read_article(args: { articleUrl: string }) {
    assertNonEmptyString('articleUrl', args?.articleUrl);

    return wixMcpCachedCall<any>({
      cachePrefix: 'docs:article:v1',
      cacheTtlSeconds: TTL_ARTICLE_SECONDS,
      toolName: 'ReadFullDocsArticle',
      toolArgs: { articleUrl: args.articleUrl },
    });
  },

  async wix_docs_read_method_schema(args: { methodId: string }) {
    assertNonEmptyString('methodId', args?.methodId);

    return wixMcpCachedCall<any>({
      cachePrefix: 'docs:methodSchema:v1',
      cacheTtlSeconds: TTL_SCHEMA_SECONDS,
      toolName: 'ReadFullDocsMethodSchema',
      toolArgs: { methodId: args.methodId },
    });
  },
} as const;
