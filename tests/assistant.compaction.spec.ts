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

import { runAssistant } from '../src/backend/assistant';
import { getOpenAIClient } from '../src/backend/openai';

const mockedGetOpenAIClient = getOpenAIClient as jest.MockedFunction<typeof getOpenAIClient>;

describe('assistant compaction wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('injects compaction summary into request input for long conversations', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'resp-compaction',
      model: 'gpt-5.4-mini',
      output: [
        {
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          content: [{ type: 'output_text', text: 'ok' }],
        },
      ],
      output_text: 'ok',
    });

    mockedGetOpenAIClient.mockReturnValue({
      responses: { create },
    } as any);

    const messages = Array.from({ length: 14 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content:
        index === 0
          ? 'Bring the repo into strong_spec compliance.'
          : index === 3
            ? 'Build failed in assistant.ts with string | null.'
            : `Message ${index + 1}`,
    }));

    await runAssistant({
      instructions: 'SYS',
      messages,
      routing: { model: 'gpt-5.4-mini', reason: 'test-compaction' },
      state: {},
    });

    const input = create.mock.calls[0][0].input as any[];
    const developerSummary = input.find(
      (item) => item?.type === 'message' && item?.role === 'developer',
    );

    expect(developerSummary).toBeDefined();
    expect(developerSummary.content[0].text).toContain('Conversation compaction summary');
    expect(developerSummary.content[0].text).toContain('Bring the repo into strong_spec compliance.');
    expect(developerSummary.content[0].text).toContain('Build failed in assistant.ts with string | null.');
  });

  it('does not compact short conversations', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'resp-short',
      model: 'gpt-5.4-mini',
      output: [
        {
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          content: [{ type: 'output_text', text: 'ok' }],
        },
      ],
      output_text: 'ok',
    });

    mockedGetOpenAIClient.mockReturnValue({
      responses: { create },
    } as any);

    await runAssistant({
      instructions: 'SYS',
      messages: [{ role: 'user', content: 'hello' }],
      routing: { model: 'gpt-5.4-mini', reason: 'test-short' },
      state: {},
    });

    const input = create.mock.calls[0][0].input as any[];
    expect(
      input.some(
        (item) => item?.type === 'message' && item?.role === 'developer' && String(item?.content?.[0]?.text ?? '').includes('Conversation compaction summary'),
      ),
    ).toBe(false);
  });
});
