jest.mock('../src/backend/tools/index', () => ({
  toolsSchemas: [
    {
      type: 'function',
      function: {
        name: 'github_get_file',
        description: 'Read a file from GitHub',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'github_commit_file',
        description: 'Write a file to GitHub',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['path', 'content'],
        },
      },
    },
  ],
  toolsHandlers: {
    github_get_file: jest.fn(async (args: unknown) => ({ ok: true, kind: 'read', args })),
    github_commit_file: jest.fn(async (args: unknown) => ({ ok: true, kind: 'write', args })),
  },
}));

function names(tools: any[]): string[] {
  return tools.map((tool: any) => tool?.name ?? tool?.function?.name).filter(Boolean);
}

describe('tool access policy', () => {
  test('repo audit exposes only read-only tools to the model', () => {
    const { getToolsSchemas } = require('../src/backend/tools');

    expect(names(getToolsSchemas())).toEqual(['github_get_file', 'github_commit_file']);
    expect(names(getToolsSchemas('repo_audit'))).toEqual(['github_get_file']);
  });

  test('repo audit allows read-only tool execution and blocks mutating tools', async () => {
    const { handleToolCall } = require('../src/backend/tools');
    const { toolsHandlers } = require('../src/backend/tools/index');

    await expect(
      handleToolCall('github_get_file', { path: 'README.md' }, 'repo_audit'),
    ).resolves.not.toThrow;

    expect(toolsHandlers.github_get_file).toHaveBeenCalledWith({ path: 'README.md' });

    await expect(
      handleToolCall(
        'github_commit_file',
        { path: 'README.md', content: 'x' },
        'repo_audit',
      ),
    ).rejects.toThrow('not allowed');
  });
});
