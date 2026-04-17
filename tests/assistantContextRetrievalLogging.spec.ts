import { jest } from '@jest/globals';

const mockBuildContextAugmentedInstructions = jest.fn();

jest.mock('../src/backend/openai', () => ({
  getOpenAIClient: jest.fn(),
}));

jest.mock('../src/backend/tools', () => ({
  getToolsSchemas: jest.fn(() => []),
  handleToolCall: jest.fn(),
}));

jest.mock('../src/backend/retrieval/buildContextAugmentedInstructions', () => ({
  buildContextAugmentedInstructions: (...args: any[]) => mockBuildContextAugmentedInstructions(...args),
}));

import { clearRecentRunEvents, getRecentRunEvents } from '../src/backend/log';
import { runAssistant } from '../src/backend/assistant';
import { getOpenAIClient } from '../src/backend/openai';

const mockedGetOpenAIClient = getOpenAIClient as jest.MockedFunction<typeof getOpenAIClient>;

describe('assistant retrieval logging', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearRecentRunEvents();

    mockBuildContextAugmentedInstructions.mockResolvedValue({
      instructions: 'sys',
      retrieval: {
        status: 'empty',
        source: 'dev_wix_docs',
        query: 'wix sdk auth',
      },
    });
  });

  test('logs explicit retrieval status for the turn', async () => {
    mockedGetOpenAIClient.mockReturnValue({
      responses: {
        create: jest.fn().mockResolvedValue({
          id: 'resp-1',
          model: 'gpt-5.4-mini',
          output: [
            {
              type: 'message',
              role: 'assistant',
              phase: 'final_answer',
              content: [{ type: 'output_text', text: 'done' }],
            },
          ],
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            total_tokens: 15,
          },
        }),
      },
    } as any);

    const result = await runAssistant({
      instructions: 'sys',
      messages: [{ role: 'user', content: 'wix sdk auth' }],
      routing: { model: 'gpt-5.4-mini', reasoning: { effort: 'low' }, reason: 'test' },
      state: {},
    });

    expect(result.error).toBeUndefined();
    expect(mockBuildContextAugmentedInstructions).toHaveBeenCalledWith({
      instructions: 'sys',
      messages: [{ role: 'user', content: 'wix sdk auth' }],
    });

    const events = getRecentRunEvents();
    const retrievalEvent = events.find((event) => event.event === 'assistant_context_retrieval_status');

    expect(retrievalEvent).toBeDefined();
    expect(retrievalEvent?.payload).toEqual(
      expect.objectContaining({
        retrievalStatus: 'empty',
        retrievalSource: 'dev_wix_docs',
        retrievalQuery: 'wix sdk auth',
        finalStatus: 'in_progress',
      }),
    );
  });
});
