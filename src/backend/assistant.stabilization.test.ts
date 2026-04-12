jest.mock('./openai', () => ({
  getOpenAIClient: jest.fn(() => ({ responses: { create: jest.fn() } })),
}));

jest.mock('./tools', () => ({
  getToolsSchemas: jest.fn(),
  handleToolCall: jest.fn(),
}));

import { clearRecentRunEvents, getRecentRunEvents } from './log';
import { runAssistant } from './assistant';
import { getOpenAIClient } from './openai';
import { getToolsSchemas, handleToolCall } from './tools';

const mockedGetOpenAIClient = getOpenAIClient as jest.Mock;
const mockedGetToolsSchemas = getToolsSchemas as jest.Mock;
const mockedHandleToolCall = handleToolCall as jest.Mock;

describe('runAssistant stabilization', () => {
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
      },
    ]);
  });

  function makeResponse(params: {
    id: string;
    output: any[];
    model?: string;
    output_text?: string;
    conversationId?: string;
  }) {
    return {
      id: params.id,
      model: params.model ?? 'gpt-5.4-mini',
      output: params.output,
      output_text: params.output_text,
      conversation: params.conversationId ? { id: params.conversationId } : undefined,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
      },
    } as any;
  }

  it('logs normalized success fields on final assistant answer', async () => {
    mockedGetOpenAIClient.mockReturnValue({
      responses: {
        create: jest.fn().mockResolvedValue(
          makeResponse({
            id: 'resp-success',
            conversationId: 'conv-success',
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
    });

    const result = await runAssistant({
      instructions: 'sys',
      messages: [{ role: 'user', content: 'hello' }],
      routing: { model: 'gpt-5.4-mini', reasoning: { effort: 'low' }, reason: 'test' },
      state: {},
    });

    expect(result.error).toBeUndefined();
    expect(result.state).toEqual({
      conversationId: 'conv-success',
      latestResponseId: 'resp-success',
    });

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
    });

    const result = await runAssistant({
      instructions: 'sys',
      messages: [{ role: 'user', content: 'hello' }],
      routing: { model: 'gpt-5.4-mini', reasoning: { effort: 'low' }, reason: 'test' },
      state: {},
    });

    expect(result.error?.internalCode).toBe('invalid_tool_args_json');

    const events = getRecentRunEvents();
    const warnEvent = events.find((event) => event.payload.stopReason === 'invalid_tool_args_json');

    expect(warnEvent?.payload.finalStatus).toBe('failed');
    expect(warnEvent?.payload.argsParseOk).toBe(false);
    expect(warnEvent?.payload.stopReason).toBe('invalid_tool_args_json');
  });

  it('uses conversation mode as priority and never mixes previous_response_id in same request', async () => {
    const create = jest.fn().mockResolvedValue(
      makeResponse({
        id: 'resp-conversation',
        conversationId: 'conv-1',
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
    });

    const result = await runAssistant({
      instructions: 'sys',
      messages: [{ role: 'user', content: 'hello' }],
      routing: { model: 'gpt-5.4-mini', reasoning: { effort: 'low' }, reason: 'test' },
      state: { conversationId: 'conv-1', previousResponseId: 'resp-old' },
    });

    expect(result.error).toBeUndefined();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].conversation).toEqual({ id: 'conv-1' });
    expect(create.mock.calls[0][0].previous_response_id).toBeUndefined();
  });

  it('passes previous_response_id only on follow-up loop request when no conversation state exists', async () => {
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
    });
    mockedHandleToolCall.mockResolvedValue({ ok: true });

    const result = await runAssistant({
      instructions: 'sys',
      messages: [{ role: 'user', content: 'hello' }],
      routing: { model: 'gpt-5.4-mini', reasoning: { effort: 'low' }, reason: 'test' },
      state: {},
    });

    expect(result.error).toBeUndefined();
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].previous_response_id).toBeUndefined();
    expect(create.mock.calls[0][0].conversation).toBeUndefined();
    expect(create.mock.calls[1][0].previous_response_id).toBe('resp-1');
    expect(create.mock.calls[1][0].conversation).toBeUndefined();
  });

  it('logs repeated tool call as fatal stop with dedicated reason', async () => {
    const create = jest
      .fn()
      .mockResolvedValueOnce(
        makeResponse({
          id: 'resp-repeat-1',
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
          id: 'resp-repeat-2',
          output: [
            {
              type: 'function_call',
              call_id: 'call-2',
              name: 'demo_tool',
              arguments: JSON.stringify({ value: 'x' }),
            },
          ],
        }),
      );

    mockedGetOpenAIClient.mockReturnValue({
      responses: { create },
    });
    mockedHandleToolCall.mockResolvedValue({ ok: true });

    const result = await runAssistant({
      instructions: 'sys',
      messages: [{ role: 'user', content: 'hello' }],
      routing: { model: 'gpt-5.4-mini', reasoning: { effort: 'low' }, reason: 'test' },
      state: {},
    });

    expect(result.error?.internalCode).toBe('repeated_tool_call');

    const events = getRecentRunEvents();
    const warnEvent = events.find((event) => event.payload.stopReason === 'repeated_tool_call');

    expect(warnEvent?.payload.finalStatus).toBe('failed');
    expect(warnEvent?.payload.stopReason).toBe('repeated_tool_call');
  });
  
  it('accepts nullable union types in tool schema', async () => {
    mockedGetToolsSchemas.mockReturnValue([
      {
        type: 'function',
        name: 'demo_tool',
        description: 'demo',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            value: { type: 'string' },
            note: { type: ['string', 'null'] },
          },
          required: ['value', 'note'],
        },
      },
    ]);

    const create = jest
      .fn()
      .mockResolvedValueOnce(
        makeResponse({
          id: 'resp-union-1',
          output: [
            {
              type: 'function_call',
              call_id: 'call-union-1',
              name: 'demo_tool',
              arguments: JSON.stringify({ value: 'x', note: null }),
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          id: 'resp-union-2',
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
    });
    mockedHandleToolCall.mockResolvedValue({ ok: true });

    const result = await runAssistant({
      instructions: 'sys',
      messages: [{ role: 'user', content: 'hello' }],
      routing: { model: 'gpt-5.4-mini', reasoning: { effort: 'low' }, reason: 'test' },
      state: {},
    });

    expect(result.error).toBeUndefined();
    expect(mockedHandleToolCall).toHaveBeenCalledTimes(1);
    expect(mockedHandleToolCall).toHaveBeenCalledWith('demo_tool', { value: 'x' });
  });

  it('fails fast on invalid tool args schema when required nullable field is omitted', async () => {
    mockedGetToolsSchemas.mockReturnValue([
      {
        type: 'function',
        name: 'demo_tool',
        description: 'demo',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            value: { type: 'string' },
            note: { type: ['string', 'null'] },
          },
          required: ['value', 'note'],
        },
      },
    ]);

    mockedGetOpenAIClient.mockReturnValue({
      responses: {
        create: jest.fn().mockResolvedValue(
          makeResponse({
            id: 'resp-schema-miss',
            output: [
              {
                type: 'function_call',
                call_id: 'call-schema-miss',
                name: 'demo_tool',
                arguments: JSON.stringify({ value: 'x' }),
              },
            ],
          }),
        ),
      },
    });

    const result = await runAssistant({
      instructions: 'sys',
      messages: [{ role: 'user', content: 'hello' }],
      routing: { model: 'gpt-5.4-mini', reasoning: { effort: 'low' }, reason: 'test' },
      state: {},
    });

    expect(result.error?.internalCode).toBe('invalid_tool_args_schema');
    expect(mockedHandleToolCall).not.toHaveBeenCalled();

    const events = getRecentRunEvents();
    const warnEvent = events.find((event) => event.payload.stopReason === 'invalid_tool_args_schema');

    expect(warnEvent?.payload.finalStatus).toBe('failed');
    expect(warnEvent?.payload.argsParseOk).toBe(true);
    expect(warnEvent?.payload.schemaValid).toBe(false);
    expect(warnEvent?.payload.stopReason).toBe('invalid_tool_args_schema');
  });
});
