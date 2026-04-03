jest.mock('../src/backend/openai', () => ({
  getOpenAIClient: jest.fn(),
}));

jest.mock('../src/backend/tools', () => ({
  getToolsSchemas: jest.fn(),
  handleToolCall: jest.fn(),
}));

import { clearRecentRunEvents, getRecentRunEvents } from '../src/backend/log';
import { runAssistant } from '../src/backend/assistant';
import { getOpenAIClient } from '../src/backend/openai';
import { getToolsSchemas, handleToolCall } from '../src/backend/tools';

const mockedGetOpenAIClient = getOpenAIClient as jest.MockedFunction<typeof getOpenAIClient>;
const mockedGetToolsSchemas = getToolsSchemas as jest.MockedFunction<typeof getToolsSchemas>;
const mockedHandleToolCall = handleToolCall as jest.MockedFunction<typeof handleToolCall>;

function makeResponse(params: {
  id: string;
  output: any[];
  model?: string;
}) {
  return {
    id: params.id,
    model: params.model ?? 'gpt-5.4-mini',
    output: params.output,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
    },
  } as any;
}

describe('assistant stabilization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearRecentRunEvents();

    mockedGetToolsSchemas.mockReturnValue([
      {
        type: 'function',
        name: 'demo_tool',
        description: 'demo',
        parameters: {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
          required: ['value'],
          additionalProperties: false,
        },
      } as any,
    ]);
  });

  it('logs normalized success fields on final assistant answer', async () => {
    mockedGetOpenAIClient.mockReturnValue({
      responses: {
        create: jest.fn().mockResolvedValue(
          makeResponse({
            id: 'resp-success',
            output: [
              {
                type: 'message',
                role: 'assistant',
                phase: 'final_answer',
                content: [{ type: 'output_text', text: 'done' }],
              },
            ],
          }),
        ),
      },
    } as any);

    const result = await runAssistant(
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hello' },
      ],
      { model: 'gpt-5.4-mini', reasoning: { effort: 'low' }, reason: 'test' },
    );

    expect(result.error).toBeUndefined();

    const events = getRecentRunEvents();
    const finalEvent = events.find((event) => event.event === 'assistant_run_completed');

    expect(finalEvent).toBeDefined();
    expect(finalEvent?.payload.finalStatus).toBe('completed');
    expect(finalEvent?.payload.model).toBe('gpt-5.4-mini');
    expect(finalEvent?.payload.modelReason).toBe('test');
    expect(finalEvent?.payload.reasoningEffort).toBe('low');
    expect(finalEvent?.payload.duration).toEqual(expect.any(Number));
  });

  it('fails fast on invalid tool args json', async () => {
    mockedGetOpenAIClient.mockReturnValue({
      responses: {
        create: jest.fn().mockResolvedValue(
          makeResponse({
            id: 'resp-bad-json',
            output: [
              {
                type: 'function_call',
                call_id: 'call-1',
                name: 'demo_tool',
                arguments: '{bad json',
              },
            ],
          }),
        ),
      },
    } as any);

    const result = await runAssistant(
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hello' },
      ],
      { model: 'gpt-5.4-mini', reasoning: { effort: 'low' }, reason: 'test' },
    );

    expect(result.error?.internalCode).toBe('invalid_tool_args_json');

    const events = getRecentRunEvents();
    const warnEvent = events.find((event) => event.event === 'assistant_invalid_tool_args_json');

    expect(warnEvent?.payload.finalStatus).toBe('failed');
    expect(warnEvent?.payload.argsParseOk).toBe(false);
  });

  it('passes previous_response_id only on follow-up loop request', async () => {
    const create = jest
      .fn()
      .mockResolvedValueOnce(
        makeResponse({
          id: 'resp-1',
          output: [
            {
              type: 'function_call',
              call_id: 'call-1',
              name: 'demo_tool',
              arguments: JSON.stringify({ value: 'x' }),
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          id: 'resp-2',
          output: [
            {
              type: 'message',
              role: 'assistant',
              phase: 'final_answer',
              content: [{ type: 'output_text', text: 'done' }],
            },
          ],
        }),
      );

    mockedGetOpenAIClient.mockReturnValue({
      responses: { create },
    } as any);
    mockedHandleToolCall.mockResolvedValue({ ok: true });

    const result = await runAssistant(
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hello' },
      ],
      { model: 'gpt-5.4-mini', reasoning: { effort: 'low' }, reason: 'test' },
    );

    expect(result.error).toBeUndefined();
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].previous_response_id).toBeUndefined();
    expect(create.mock.calls[1][0].previous_response_id).toBe('resp-1');
  });
});
