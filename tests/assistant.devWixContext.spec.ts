jest.mock('../src/backend/openai', () => ({
  getOpenAIClient: jest.fn(),
}));

jest.mock('../src/backend/tools', () => ({
  getToolsSchemas: jest.fn(() => []),
  handleToolCall: jest.fn(),
}));

jest.mock('../src/backend/log', () => ({
  logEvent: jest.fn().mockResolvedValue(undefined),
  logInfo: jest.fn().mockResolvedValue(undefined),
  logWarn: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/backend/devWixDocs/retrieve', () => ({
  retrieveDevWixContext: jest.fn(),
  formatDevWixContext: jest.fn((chunks: Array<{ url: string; content: string }>) =>
    chunks.length ? `Wix developer docs context (dev.wix.com/docs):\n- Source: ${chunks[0].url}\n${chunks[0].content}` : '',
  ),
}));

import { runAssistant } from '../src/backend/assistant';
import { getOpenAIClient } from '../src/backend/openai';
import { retrieveDevWixContext, formatDevWixContext } from '../src/backend/devWixDocs/retrieve';

describe('assistant dev wix retrieval wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (formatDevWixContext as jest.Mock).mockImplementation(
      (chunks: Array<{ url: string; content: string }>) =>
        chunks.length
          ? `Wix developer docs context (dev.wix.com/docs):\n- Source: ${chunks[0].url}\n${chunks[0].content}`
          : '',
    );
  });

  it('injects retrieved Wix docs context into instructions for Wix-related prompts', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'resp_ctx',
      model: 'gpt-5.4-mini',
      output_text: 'ok',
      output: [],
    });

    (getOpenAIClient as jest.Mock).mockReturnValue({ responses: { create } });
    (retrieveDevWixContext as jest.Mock).mockResolvedValue({
      queryEmbeddingDims: 2,
      chunks: [{ url: 'https://dev.wix.com/docs/sdk', title: 'SDK', content: 'sdk rules', score: 0.99 }],
    });

    await runAssistant({
      instructions: 'SYS',
      messages: [{ role: 'user', content: 'Check Wix SDK usage' }],
      routing: { model: 'gpt-5.4-mini', reason: 'test' },
      state: {},
    });

    expect(retrieveDevWixContext).toHaveBeenCalledWith({ query: 'Check Wix SDK usage', topK: 4, maxChars: 5000 });
    expect(create.mock.calls[0][0].instructions).toContain('Wix developer docs context (dev.wix.com/docs):');
    expect(create.mock.calls[0][0].instructions).toContain('https://dev.wix.com/docs/sdk');
  });

  it('does not retrieve Wix docs context for unrelated prompts', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'resp_no_ctx',
      model: 'gpt-5.4-mini',
      output_text: 'ok',
      output: [],
    });

    (getOpenAIClient as jest.Mock).mockReturnValue({ responses: { create } });

    await runAssistant({
      instructions: 'SYS',
      messages: [{ role: 'user', content: 'Fix failing repo tests' }],
      routing: { model: 'gpt-5.4-mini', reason: 'test' },
      state: {},
    });

    expect(retrieveDevWixContext).not.toHaveBeenCalled();
    expect(create.mock.calls[0][0].instructions).toBe('SYS');
  });
});
