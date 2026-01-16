import { wixDocsToolHandlers } from '../src/backend/tools/wixDocsTools';

// We mock the MCP layer to keep tests deterministic and offline.
jest.mock('../src/backend/wixMcp', () => ({
  wixMcpListTools: jest.fn(async () => [
    { name: 'SearchSiteApiDocs', description: 'search docs' },
    { name: 'ReadFullDocsArticle', description: 'read article' },
    { name: 'ReadFullDocsMethodSchema', description: 'read schema' },
  ]),
  wixMcpCachedCall: jest.fn(async (opts: any) => {
    if (opts.toolName === 'SearchSiteApiDocs') {
      return [{ title: 'x', url: 'https://dev.wix.com/x' }];
    }
    if (opts.toolName === 'ReadFullDocsArticle') {
      return { text: 'article text' };
    }
    if (opts.toolName === 'ReadFullDocsMethodSchema') {
      return { schema: { ok: true } };
    }
    return { ok: true };
  }),
}));

describe('wixDocsToolHandlers', () => {
  test('wix_docs_list_mcp_tools returns minimal tool list', async () => {
    const res = await wixDocsToolHandlers.wix_docs_list_mcp_tools();
    expect(Array.isArray(res.tools)).toBe(true);
    expect(res.tools[0]).toHaveProperty('name');
  });

  test('wix_docs_list_mcp_tools handles upstream empty list', async () => {
    const { wixMcpListTools } = jest.requireMock('../src/backend/wixMcp');
    wixMcpListTools.mockResolvedValueOnce([]);

    const res = await wixDocsToolHandlers.wix_docs_list_mcp_tools();
    expect(res).toEqual({ tools: [] });
  });

  test('wix_docs_search clamps limit and returns items', async () => {
    const res = await wixDocsToolHandlers.wix_docs_search({ query: 'contacts', limit: 999 });
    expect(res).toHaveProperty('items');
    expect(res.items.length).toBeLessThanOrEqual(10);
  });

  test('wix_docs_read_article validates input', async () => {
    await expect(
      wixDocsToolHandlers.wix_docs_read_article({ articleUrl: 'https://dev.wix.com/x' }),
    ).resolves.toBeDefined();
  });

  test('wix_docs_read_method_schema validates input', async () => {
    await expect(
      wixDocsToolHandlers.wix_docs_read_method_schema({
        articleUrl:
          'https://dev.wix.com/docs/rest/business-solutions/cms/collection-management/data-collections/create-data-collection',
      }),
    ).resolves.toBeDefined();
  });
});
