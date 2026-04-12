jest.mock('../src/backend/openai', () => ({
  getOpenAIClient: jest.fn(),
}));

jest.mock('../src/backend/tools', () => ({
  getToolsSchemas: jest.fn(),
  handleToolCall: jest.fn(),
}));

jest.mock('../src/backend/log', () => ({
  logEvent: jest.fn().mockResolvedValue(undefined),
  logInfo: jest.fn().mockResolvedValue(undefined),
  logWarn: jest.fn().mockResolvedValue(undefined),
}));

import { runAssistant } from '../src/backend/assistant';
import { getOpenAIClient } from '../src/backend/openai';
import { getToolsSchemas, handleToolCall } from '../src/backend/tools';

const mockedGetOpenAIClient = getOpenAIClient as jest.MockedFunction<typeof getOpenAIClient>;
const mockedGetToolsSchemas = getToolsSchemas as jest.MockedFunction<typeof getToolsSchemas>;
const mockedHandleToolCall = handleToolCall as jest.MockedFunction<typeof handleToolCall>;

function makeResponse(params: { id: string; output: any[]; output_text?: string }) {
  return {
    id: params.id,
    model: 'gpt-5.4',
    output: params.output,
    output_text: params.output_text,
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  } as any;
}

describe('assistant audit mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetToolsSchemas.mockReturnValue([
      {
        type: 'function',
        name: 'demo_tool',
        description: 'demo',
        parameters: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
          additionalProperties: false,
        },
      } as any,
    ]);
    mockedHandleToolCall.mockResolvedValue({ ok: true });
  });

  test('uses expanded execution budget for repo-wide audit requests', async () => {
    const responses: any[] = [];

    for (let round = 1; round <= 13; round += 1) {
      responses.push(
        makeResponse({
          id: `resp-${round}`,
          output: [
            {
              type: 'function_call',
              call_id: `call-${round}-a`,
              name: 'demo_tool',
              arguments: JSON.stringify({ value: `round-${round}-a` }),
            },
            {
              type: 'function_call',
              call_id: `call-${round}-b`,
              name: 'demo_tool',
              arguments: JSON.stringify({ value: `round-${round}-b` }),
            },
          ],
        }),
      );
    }

    responses.push(
      makeResponse({
        id: 'resp-final',
        output: [
          {
            type: 'message',
            role: 'assistant',
            phase: 'final_answer',
            content: [{ type: 'output_text', text: 'audit done' }],
          },
        ],
        output_text: 'audit done',
      }),
    );

    const create = jest.fn();
    for (const response of responses) create.mockResolvedValueOnce(response);

    mockedGetOpenAIClient.mockReturnValue({
      responses: { create },
    } as any);

    const result = await runAssistant({
      instructions: 'SYS',
      messages: [
        {
          role: 'user',
          content:
            'Work in repo fairyplace-mailer/botcow_assistance branch provecta. Make a full audit against docs/strong_spec.md. Check strict mode. Do not change anything.',
        },
      ],
      routing: {
        model: 'gpt-5.4',
        reasoning: { effort: 'high' },
        reason: 'deep-code-debug-review',
      },
      state: {},
    });

    expect(result.error).toBeUndefined();
    expect(result.response?.id).toBe('resp-final');
    expect(create).toHaveBeenCalledTimes(14);
    expect(create.mock.calls[0][0].instructions).toContain('Repository audit mode:');
    expect(create.mock.calls[0][0].instructions).toContain('Do not modify files, do not commit, do not deploy.');
    expect(create.mock.calls[0][0].instructions).toContain('First read docs/strong_spec.md before judging compliance.');
    expect(create.mock.calls[0][0].instructions).toContain('Ignore removed legacy paths such as docs/spec.md.');
    expect(create.mock.calls[0][0].instructions).toContain('github_get_files_batch');
  });
});
