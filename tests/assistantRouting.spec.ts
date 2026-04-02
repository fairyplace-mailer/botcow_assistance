jest.mock('../src/backend/openai', () => ({
  getOpenAIClient: jest.fn(),
}));

jest.mock('../src/backend/tools', () => ({
  getToolsSchemas: jest.fn(() => []),
  handleToolCall: jest.fn(),
}));

import { runAssistant } from '../src/backend/assistant';
import { getOpenAIClient } from '../src/backend/openai';

describe('assistant routing propagation', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('passes model and reasoning to OpenAI request payload', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'ok',
          },
        },
      ],
    });

    (getOpenAIClient as jest.Mock).mockReturnValue({
      chat: {
        completions: { create },
      },
    });

    await runAssistant(
      [{ role: 'user', content: 'debug this stack trace' }],
      {
        model: 'gpt-5.4',
        reasoning: { effort: 'xhigh' },
      },
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5.4',
        reasoning: { effort: 'xhigh' },
      }),
    );
  });

  test('works without reasoning and does not send it', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'ok',
          },
        },
      ],
    });

    (getOpenAIClient as jest.Mock).mockReturnValue({
      chat: {
        completions: { create },
      },
    });

    await runAssistant(
      [{ role: 'user', content: 'hello' }],
      {
        model: 'gpt-5.4-mini',
      },
    );

    expect(create).toHaveBeenCalledTimes(1);
    const request = create.mock.calls[0][0];
    expect(request.model).toBe('gpt-5.4-mini');
    expect('reasoning' in request).toBe(false);
  });
});
