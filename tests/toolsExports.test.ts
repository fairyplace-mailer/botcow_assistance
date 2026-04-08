jest.mock('../src/backend/tools/githubTools', () => ({
  githubToolsSchemas: [
    {
      type: 'function',
      function: {
        name: 'github_search_in_repo',
        description: 'Search code in a GitHub repository',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string' },
            repo: { type: 'string' },
            path: { type: 'string' },
            per_page: { type: 'integer', minimum: 1, maximum: 100 },
            page: { type: 'integer', minimum: 1 },
          },
          required: ['query'],
        },
      },
    },
  ],
  githubToolHandlers: {
    github_search_in_repo: jest.fn(),
  },
}));

jest.mock('../src/backend/tools/deploymentTools', () => ({
  deploymentToolsSchemas: [
    {
      type: 'function',
      function: {
        name: 'get_preview_url',
        description: 'Get preview URL for a given git sha or branch',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            repo: { type: 'string' },
            git_sha: { type: 'string' },
            branch: { type: 'string' },
            target: { type: 'string', enum: ['preview'] },
            timeWindowMinutes: { type: 'integer' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'preview_http_request',
        description: 'Perform a safe HTTP request to a preview deployment',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            baseUrl: { type: 'string' },
            path: { type: 'string' },
            method: { type: 'string', enum: ['GET', 'POST'] },
            body: {},
            timeoutMs: { type: 'integer' },
            maxResponseChars: { type: 'integer' },
          },
          required: ['baseUrl', 'path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'preview_smoke_check',
        description: 'Run smoke checks against latest preview deployment',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            repo: { type: 'string' },
            git_sha: { type: 'string' },
            branch: { type: 'string' },
          },
        },
      },
    },
  ],
  deploymentToolHandlers: {
    get_preview_url: jest.fn(),
    preview_http_request: jest.fn(),
    preview_smoke_check: jest.fn(),
  },
}));

import { toolSchemas, toolHandlers, type ToolName } from '../src/backend/tools';

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

describe('tools export contract', () => {
  test('every tool schema has a handler and handler is a function', () => {
    const names = toolSchemas
      .map((s: any) => s?.function?.name)
      .filter(isNonEmptyString);

    // basic sanity: we expect some tools
    expect(names.length).toBeGreaterThan(0);

    const missing: string[] = [];
    const nonFn: string[] = [];

    for (const name of names) {
      const handler = (toolHandlers as any)[name as ToolName];
      if (!handler) missing.push(name);
      else if (typeof handler !== 'function') nonFn.push(name);
    }

    expect(missing).toEqual([]);
    expect(nonFn).toEqual([]);
  });

  test('handlers should not expose extra tool names not present in schemas', () => {
    const schemaNames = new Set(
      toolSchemas
        .map((s: any) => s?.function?.name)
        .filter(isNonEmptyString),
    );

    const handlerNames = Object.keys(toolHandlers);

    const extra = handlerNames.filter((n) => !schemaNames.has(n));

    // Allow internal helpers if any; currently we want exact match.
    expect(extra).toEqual([]);
  });
});
