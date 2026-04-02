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

  test('passes reasoning to responses.create for reasoning-capable model', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'resp_1',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: 'ok',
            },
          ],
        },
      ],
      output_text: 'ok',
    });

    (getOpenAIClient as jest.Mock).mockReturnValue({
      responses: { create },
    });

    await runAssistant(
      [{ role: 'user', content: 'debug this stack trace' }],
      {
        model: 'gpt-5.4',
        reasoning: { effort: 'xhigh' },
      },
    );

    expect(create).toHaveBeenCalledTimes(1);
    const request = create.mock.calls[0][0];
    expect(request.model).toBe('gpt-5.4');
    expect(request.reasoning).toEqual({ effort: 'xhigh' });
  });

  test('does not send reasoning for unsupported model', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'resp_2',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: 'ok',
            },
          ],
        },
      ],
      output_text: 'ok',
    });

    (getOpenAIClient as jest.Mock).mockReturnValue({
      responses: { create },
    });

    await runAssistant(
      [{ role: 'user', content: 'hello' }],
      {
        model: 'gpt-5.4-mini',
        reasoning: { effort: 'high' },
      },
    );

    expect(create).toHaveBeenCalledTimes(1);
    const request = create.mock.calls[0][0];
    expect(request.model).toBe('gpt-5.4-mini');
    expect(Object.prototype.hasOwnProperty.call(request, 'reasoning')).toBe(false);
  });
});
