jest.mock('../src/backend/tools', () => ({
  getToolsSchemas: jest.fn(() => [
    {
      type: 'function',
      function: {
        name: 'tool_one',
        description: 'tool one',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
    },
  ]),
  handleToolCall: jest.fn(),
}));

jest.mock('../src/backend/openai', () => ({
  getOpenAIClient: jest.fn(),
}));

jest.mock('../src/backend/log', () => ({
  logEvent: jest.fn().mockResolvedValue(undefined),
  logInfo: jest.fn().mockResolvedValue(undefined),
  logWarn: jest.fn().mockResolvedValue(undefined),
}));

import {
  buildFunctionCallOutputs,
  buildResponsesInput,
  createModelResponse,
  extractFinalAssistantMessage,
  extractFunctionCalls,
  makeFunctionCallOutputItem,
  validateResponsesInput,
} from '../src/backend/responses';
import { buildResponsesRequest, runAssistant } from '../src/backend/assistant';
import { OPENAI_SDK_VERSION } from '../src/backend/openaiRuntime';
import { getOpenAIClient } from '../src/backend/openai';
import { handleToolCall } from '../src/backend/tools';

describe('responses + assistant tool loop spec', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('bad JSON args aborts immediately and tool is not called', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'resp_bad_json',
      output: [
        {
          type: 'function_call',
          call_id: 'call_bad_json',
          name: 'tool_one',
          arguments: '{"broken":',
        },
      ],
    });

    (getOpenAIClient as jest.Mock).mockReturnValue({ responses: { create } });

    const result = await runAssistant([{ role: 'user', content: 'run' }], {
      model: 'gpt-5.4',
      reasoning: { effort: 'none' },
    });

    expect(result.error).toEqual(
      expect.objectContaining({
        publicCode: 'assistant_run_failed',
        internalCode: 'invalid_tool_args_json',
      }),
    );
    expect(handleToolCall).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
  });

  test('unknown tool aborts immediately', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'resp_unknown_tool',
      output: [
        {
          type: 'function_call',
          call_id: 'call_unknown',
          name: 'missing_tool',
          arguments: '{}',
        },
      ],
    });

    (getOpenAIClient as jest.Mock).mockReturnValue({ responses: { create } });

    const result = await runAssistant([{ role: 'user', content: 'run' }], {
      model: 'gpt-5.4',
      reasoning: { effort: 'none' },
    });

    expect(result.error).toEqual(
      expect.objectContaining({
        publicCode: 'assistant_run_failed',
        internalCode: 'unknown_tool',
      }),
    );
    expect(handleToolCall).not.toHaveBeenCalled();
  });

  test('tool timeout aborts immediately', async () => {
    jest.useFakeTimers();

    const create = jest.fn().mockResolvedValue({
      id: 'resp_timeout',
      output: [
        {
          type: 'function_call',
          call_id: 'call_timeout',
          name: 'tool_one',
          arguments: '{}',
        },
      ],
    });

    (handleToolCall as jest.Mock).mockImplementation(
      () => new Promise(() => undefined),
    );
    (getOpenAIClient as jest.Mock).mockReturnValue({ responses: { create } });

    const promise = runAssistant([{ role: 'user', content: 'run' }], {
      model: 'gpt-5.4',
      reasoning: { effort: 'none' },
    });

    await jest.advanceTimersByTimeAsync(20_000);
    const result = await promise;

    expect(result.error).toEqual(
      expect.objectContaining({
        publicCode: 'assistant_run_failed',
        internalCode: 'tool_timeout',
      }),
    );

    jest.useRealTimers();
  });

  test('repeated tool call aborts on second identical round', async () => {
    (handleToolCall as jest.Mock).mockResolvedValue({ ok: true });

    const create = jest
      .fn()
      .mockResolvedValueOnce({
        id: 'resp_repeat_1',
        output: [
          {
            type: 'function_call',
            call_id: 'call_repeat_1',
            name: 'tool_one',
            arguments: '{}',
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 'resp_repeat_2',
        output: [
          {
            type: 'function_call',
            call_id: 'call_repeat_2',
            name: 'tool_one',
            arguments: '{}',
          },
        ],
      });

    (getOpenAIClient as jest.Mock).mockReturnValue({ responses: { create } });

    const result = await runAssistant([{ role: 'user', content: 'run' }], {
      model: 'gpt-5.4',
      reasoning: { effort: 'none' },
    });

    expect(result.error).toEqual(
      expect.objectContaining({
        internalCode: 'repeated_tool_call',
      }),
    );
    expect(handleToolCall).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(2);
  });

  test('no progress aborts after two empty rounds in a row', async () => {
    const create = jest
      .fn()
      .mockResolvedValueOnce({
        id: 'resp_np_1',
        output: [],
      })
      .mockResolvedValueOnce({
        id: 'resp_np_2',
        output: [],
      });

    (getOpenAIClient as jest.Mock).mockReturnValue({ responses: { create } });

    const result = await runAssistant([{ role: 'user', content: 'run' }], {
      model: 'gpt-5.4',
      reasoning: { effort: 'none' },
    });

    expect(result.error).toEqual(
      expect.objectContaining({
        internalCode: 'no_progress_abort',
      }),
    );
    expect(create).toHaveBeenCalledTimes(2);
  });

  test('full tool round-trip keeps previous_response_id and returns final answer', async () => {
    (handleToolCall as jest.Mock).mockResolvedValue({ ok: true });

    const create = jest
      .fn()
      .mockResolvedValueOnce({
        id: 'resp_roundtrip_1',
        output: [
          {
            type: 'function_call',
            call_id: 'call_roundtrip_1',
            name: 'tool_one',
            arguments: '{}',
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 'resp_roundtrip_2',
        output: [
          {
            type: 'message',
            role: 'assistant',
            phase: 'final_answer',
            content: [{ type: 'output_text', text: 'done' }],
          },
        ],
        output_text: 'done',
      });

    (getOpenAIClient as jest.Mock).mockReturnValue({ responses: { create } });

    const result = await runAssistant(
      [
        { role: 'system', content: 'DEV_INSTR' },
        { role: 'user', content: 'run' },
      ],
      {
        model: 'gpt-5.4',
        reasoning: { effort: 'none' },
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.response?.id).toBe('resp_roundtrip_2');
    expect(create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        previous_response_id: 'resp_roundtrip_1',
        instructions: 'DEV_INSTR',
        input: [
          {
            type: 'function_call_output',
            call_id: 'call_roundtrip_1',
            output: '{"ok":true}',
          },
        ],
      }),
    );
  });

  test('buildResponsesInput keeps assistant history and phase', () => {
    const built = buildResponsesInput([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'thinking', phase: 'commentary' },
    ]);

    expect(built.instructions).toBe('sys');
    expect(built.input).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'hello' }],
      },
      {
        type: 'message',
        role: 'assistant',
        phase: 'commentary',
        content: [{ type: 'input_text', text: 'thinking' }],
      },
    ]);
  });

  test('extractFinalAssistantMessage prefers final_answer phase', () => {
    expect(
      extractFinalAssistantMessage({
        output: [
          {
            type: 'message',
            role: 'assistant',
            phase: 'commentary',
            content: [{ type: 'output_text', text: 'thinking' }],
          },
          {
            type: 'message',
            role: 'assistant',
            phase: 'final_answer',
            content: [{ type: 'output_text', text: 'done' }],
          },
        ],
      } as any),
    ).toEqual({
      id: undefined,
      role: 'assistant',
      phase: 'final_answer',
      text: 'done',
    });
  });

  test('makeFunctionCallOutputItem keeps same call_id', () => {
    expect(makeFunctionCallOutputItem('call_123', { ok: true })).toEqual({
      type: 'function_call_output',
      call_id: 'call_123',
      output: '{"ok":true}',
    });
  });

  test('extractFunctionCalls reads name arguments and call_id', () => {
    expect(
      extractFunctionCalls([
        {
          type: 'function_call',
          call_id: 'call_123',
          name: 'tool_one',
          arguments: '{"q":"abc"}',
        } as any,
      ]),
    ).toEqual([
      {
        id: undefined,
        call_id: 'call_123',
        name: 'tool_one',
        arguments: '{"q":"abc"}',
      },
    ]);
  });

  test('createModelResponse always sends previous_response_id instructions and parallel_tool_calls false', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'resp' });
    const client = { responses: { create } } as any;

    await createModelResponse({
      client,
      model: 'gpt-5.4',
      instructions: 'DEV_INSTR',
      previousResponseId: 'resp_prev',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }] as any,
      tools: [],
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: 'DEV_INSTR',
        previous_response_id: 'resp_prev',
        parallel_tool_calls: false,
      }),
    );
  });

  test('buildResponsesRequest keeps exact payload keys for supported reasoning path', () => {
    const built = buildResponsesRequest(
      [{ role: 'user', content: 'hello' }],
      { model: 'gpt-5.4', reasoning: { effort: 'low' } },
      {
        path: 'openai.responses.create',
        reasoning: 'supported',
        sdkVersion: OPENAI_SDK_VERSION,
        apiBaseUrl: 'https://api.openai.com/v1',
        runtimeKind: 'openai',
      },
    );

    expect(Object.keys(built.request).sort()).toEqual([
      'input',
      'model',
      'parallel_tool_calls',
      'reasoning',
      'tools',
    ]);
  });

  test('stale and duplicate call_id guards still work', () => {
    const calls = extractFunctionCalls([
      {
        type: 'function_call',
        id: 'fc_1',
        call_id: 'call_1',
        name: 'tool_one',
        arguments: '{}',
      } as any,
    ]);

    expect(() =>
      buildFunctionCallOutputs(calls, [{ call_id: 'call_old', output: 'bad' }]),
    ).toThrow('Stale or unknown function_call_output call_id: call_old');

    expect(() =>
      extractFunctionCalls([
        {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_dup',
          name: 'tool_one',
          arguments: '{}',
        },
        {
          type: 'function_call',
          id: 'fc_2',
          call_id: 'call_dup',
          name: 'tool_one',
          arguments: '{}',
        },
      ] as any),
    ).toThrow('Duplicate function_call call_id in current response cycle: call_dup');
  });

  test('input validator still blocks invalid content type', () => {
    expect(() =>
      validateResponsesInput([
        {
          role: 'assistant',
          content: [{ type: 'output_text', text: 'bad' }],
        } as any,
      ]),
    ).toThrow('Responses payload validation failed: unsupported input content type output_text');
  });
});
