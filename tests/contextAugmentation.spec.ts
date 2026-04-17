import { jest } from '@jest/globals';

const retrieveDevWixContext = jest.fn();
const formatDevWixContext = jest.fn();
const logWarn = jest.fn();

jest.mock('../src/backend/devWixDocs/retrieve', () => ({
  retrieveDevWixContext: (...args: any[]) => retrieveDevWixContext(...args),
  formatDevWixContext: (...args: any[]) => formatDevWixContext(...args),
}));

jest.mock('../src/backend/log', () => ({
  logWarn: (...args: any[]) => logWarn(...args),
}));

describe('buildContextAugmentedInstructions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns original instructions when retrieval is not applicable', async () => {
    const { buildContextAugmentedInstructions } = await import('../src/backend/retrieval/buildContextAugmentedInstructions');

    const result = await buildContextAugmentedInstructions({
      instructions: 'sys',
      messages: [{ role: 'user', content: 'hello world' }],
    });

    expect(result).toEqual({
      instructions: 'sys',
      retrieval: {
        status: 'not_applicable',
        source: null,
        query: 'hello world',
      },
    });
    expect(retrieveDevWixContext).not.toHaveBeenCalled();
  });

  test('returns empty status and honesty suffix when wix retrieval finds no supporting docs', async () => {
    retrieveDevWixContext.mockResolvedValue({ chunks: [] });
    formatDevWixContext.mockReturnValue('');

    const { buildContextAugmentedInstructions } = await import('../src/backend/retrieval/buildContextAugmentedInstructions');

    const result = await buildContextAugmentedInstructions({
      instructions: 'sys',
      messages: [{ role: 'user', content: 'wix sdk auth' }],
    });

    expect(result.retrieval).toEqual({
      status: 'empty',
      source: 'dev_wix_docs',
      query: 'wix sdk auth',
    });
    expect(result.instructions).toContain('No relevant retrieved Wix docs context was found for this turn.');
    expect(result.instructions).toContain('Do not claim that Wix docs support any statement');
  });

  test('returns failed status and honesty suffix when wix retrieval throws', async () => {
    retrieveDevWixContext.mockRejectedValue(new Error('db down'));

    const { buildContextAugmentedInstructions } = await import('../src/backend/retrieval/buildContextAugmentedInstructions');

    const result = await buildContextAugmentedInstructions({
      instructions: 'sys',
      messages: [{ role: 'user', content: 'wix pricing api' }],
    });

    expect(result.retrieval).toEqual({
      status: 'failed',
      source: 'dev_wix_docs',
      query: 'wix pricing api',
    });
    expect(result.instructions).toContain('Wix docs retrieval failed for this turn.');
    expect(logWarn).toHaveBeenCalledWith(
      'assistant_context_retrieval_failed',
      expect.objectContaining({
        retrievalStatus: 'failed',
        retrievalSource: 'dev_wix_docs',
        retrievalQuery: 'wix pricing api',
      }),
    );
  });

  test('returns used status and appends retrieved context when supporting docs exist', async () => {
    retrieveDevWixContext.mockResolvedValue({ chunks: [{ id: 'c1' }] });
    formatDevWixContext.mockReturnValue('WIX_CONTEXT_BLOCK');

    const { buildContextAugmentedInstructions } = await import('../src/backend/retrieval/buildContextAugmentedInstructions');

    const result = await buildContextAugmentedInstructions({
      instructions: 'sys',
      messages: [{ role: 'user', content: 'wix members api' }],
    });

    expect(result.retrieval).toEqual({
      status: 'used',
      source: 'dev_wix_docs',
      query: 'wix members api',
    });
    expect(result.instructions).toContain('WIX_CONTEXT_BLOCK');
  });
});
