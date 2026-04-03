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
    clearRecentRunEvents();
    mockedGetToolsSchemas.mockReset();
    mockedHandleToolCall.mockReset();
    mockedGetOpenAIClient.mockClear();
  });

  function setupOpenAIResponses(responses: any[]) {
    const create = jest.fn();
    for (const response of responses) {
      create.mockResolvedValueOnce(response);
    }
    mockedGetOpenAIClient.mockReturnValue({ responses: { create } });
    return create;
  }

  const routing = {
    model: 'gpt-5.4-mini' as const,
    reasoning: { effort: 'low' as const },
    reason: 'test',
  };

  const params = {
    instructions: 'sys',
    userInput: 'hello',
    routing,
    state: {},
  };

  test('fails fast on invalid tool args json', async () => {
    mockedGetToolsSchemas.mockReturnValue([
      {
        type: 'function',
        function: {
          name: 'toolA',
          description: 'toolA',
          parameters: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
            additionalProperties: false,
          },
        },
      },
    ]);

    setupOpenAIResponses([
      {
        id: 'resp_1',
        model: 'gpt-5.4-mini',
        output: [
          {
            type: 'function_call',
            call_id: 'call_1',
            name: 'toolA',
            arguments: '{bad json',
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    ]);

    const result = await runAssistant(params);

    expect(result.error?.internalCode).toBe('invalid_tool_args_json');
    expect(mockedHandleToolCall).not.toHaveBeenCalled();
  });

  test('fails fast on schema validation error', async () => {
    mockedGetToolsSchemas.mockReturnValue([
      {
        type: 'function',
        function: {
          name: 'toolA',
          description: 'toolA',
          parameters: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
            additionalProperties: false,
          },
        },
      },
    ]);

    setupOpenAIResponses([
      {
        id: 'resp_1',
        model: 'gpt-5.4-mini',
        output: [
          {
            type: 'function_call',
            call_id: 'call_1',
            name: 'toolA',
            arguments: JSON.stringify({ wrong: 1 }),
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    ]);

    const result = await runAssistant(params);

    expect(result.error?.internalCode).toBe('invalid_tool_args_schema');
    expect(mockedHandleToolCall).not.toHaveBeenCalled();
  });

  test('fails fast on unknown tool', async () => {
    mockedGetToolsSchemas.mockReturnValue([]);

    setupOpenAIResponses([
      {
        id: 'resp_1',
        model: 'gpt-5.4-mini',
        output: [
          {
            type: 'function_call',
            call_id: 'call_1',
            name: 'missingTool',
            arguments: JSON.stringify({ value: 'x' }),
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    ]);

    const result = await runAssistant(params);

    expect(result.error?.internalCode).toBe('unknown_tool');
  });

  test('fails fast on tool execution error', async () => {
    mockedGetToolsSchemas.mockReturnValue([
      {
        type: 'function',
        function: {
          name: 'toolA',
          description: 'toolA',
          parameters: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
            additionalProperties: false,
          },
        },
      },
    ]);
    mockedHandleToolCall.mockRejectedValue(new Error('boom'));

    setupOpenAIResponses([
      {
        id: 'resp_1',
        model: 'gpt-5.4-mini',
        output: [
          {
            type: 'function_call',
            call_id: 'call_1',
            name: 'toolA',
            arguments: JSON.stringify({ value: 'x' }),
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    ]);

    const result = await runAssistant(params);

    expect(result.error?.internalCode).toBe('tool_execution_failed');
    const fatalEvent = getRecentRunEvents().find((event) => event.event === 'assistant_tool_failed');
    expect(fatalEvent?.payload.stopReason).toBe('tool_execution_failed');
    expect(fatalEvent?.payload.toolResultClass).toBe('tool_execution_failed');
    expect(fatalEvent?.payload.finalStatus).toBe('failed');
  });

  test('aborts on repeated fingerprint', async () => {
    mockedGetToolsSchemas.mockReturnValue([
      {
        type: 'function',
        function: {
          name: 'toolA',
          description: 'toolA',
          parameters: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
            additionalProperties: false,
          },
        },
      },
    ]);
    mockedHandleToolCall.mockResolvedValue({ ok: true });

    const create = setupOpenAIResponses([
      {
        id: 'resp_1',
        model: 'gpt-5.4-mini',
        output: [
          {
            type: 'function_call',
            call_id: 'call_1',
            name: 'toolA',
            arguments: JSON.stringify({ value: 'x' }),
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
      {
        id: 'resp_2',
        model: 'gpt-5.4-mini',
        output: [
          {
            type: 'function_call',
            call_id: 'call_2',
            name: 'toolA',
            arguments: JSON.stringify({ value: 'x' }),
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    ]);

    const result = await runAssistant(params);

    expect(result.error?.internalCode).toBe('repeated_tool_call');
    expect(create).toHaveBeenCalledTimes(2);
    const fatalEvent = getRecentRunEvents().find((event) => event.event === 'assistant_repeated_tool_call');
    expect(fatalEvent?.payload.stopReason).toBe('repeated_tool_call');
    expect(fatalEvent?.payload.toolResultClass).toBeNull();
    expect(fatalEvent?.payload.finalStatus).toBe('failed');
  });

  test('aborts on no progress after repeated empty rounds', async () => {
    mockedGetToolsSchemas.mockReturnValue([]);

    const create = setupOpenAIResponses([
      {
        id: 'resp_1',
        model: 'gpt-5.4-mini',
        output: [],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
      {
        id: 'resp_2',
        model: 'gpt-5.4-mini',
        output: [],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    ]);

    const result = await runAssistant(params);

    expect(result.error?.internalCode).toBe('no_progress_abort');
    expect(create).toHaveBeenCalledTimes(2);
    const fatalEvent = getRecentRunEvents().find((event) => event.event === 'assistant_no_progress_abort');
    expect(fatalEvent?.payload.stopReason).toBe('no_progress_abort');
    expect(fatalEvent?.payload.finalStatus).toBe('failed');
    expect(fatalEvent?.payload.progressThisRound).toBe(false);
    expect(fatalEvent?.payload.fingerprintChanged).toBe(false);
    expect(fatalEvent?.payload.noProgressRounds).toBe(2);
  });

  test('passes previous_response_id only inside same turn loop', async () => {
    mockedGetToolsSchemas.mockReturnValue([
      {
        type: 'function',
        function: {
          name: 'toolA',
          description: 'toolA',
          parameters: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
            additionalProperties: false,
          },
        },
      },
    ]);
    mockedHandleToolCall.mockResolvedValue({ ok: true });

    const create = setupOpenAIResponses([
      {
        id: 'resp_1',
        model: 'gpt-5.4-mini',
        output: [
          {
            type: 'function_call',
            call_id: 'call_1',
            name: 'toolA',
            arguments: JSON.stringify({ value: 'x' }),
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
      {
        id: 'resp_2',
        model: 'gpt-5.4-mini',
        output: [
          {
            type: 'message',
            role: 'assistant',
            phase: 'final_answer',
            content: [{ type: 'output_text', text: 'done' }],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    ]);

    const result = await runAssistant(params);

    expect(result.error).toBeUndefined();
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].previous_response_id).toBeUndefined();
    expect(create.mock.calls[1][0].previous_response_id).toBe('resp_1');
    expect(create.mock.calls[1][0].instructions).toBe('sys');
    expect(Array.isArray(create.mock.calls[1][0].input)).toBe(true);

    const events = getRecentRunEvents();
    expect(events.some((event) => event.payload.previousResponseId === 'resp_1')).toBe(true);
  });

  test('passes conversation reference separately from previous_response_id', async () => {
    mockedGetToolsSchemas.mockReturnValue([]);

    const create = setupOpenAIResponses([
      {
        id: 'resp_9',
        model: 'gpt-5.4-mini',
        output: [
          {
            type: 'message',
            role: 'assistant',
            phase: 'final_answer',
            content: [{ type: 'output_text', text: 'done' }],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    ]);

    const result = await runAssistant({
      ...params,
      state: { conversationId: 'conv_1' },
    });

    expect(result.error).toBeUndefined();
    expect(create.mock.calls[0][0].conversation).toEqual({ id: 'conv_1' });
    expect(create.mock.calls[0][0].previous_response_id).toBeUndefined();
    expect(result.state.conversationId).toBe('conv_1');
    expect(result.state.latestResponseId).toBe('resp_9');
  });
});
