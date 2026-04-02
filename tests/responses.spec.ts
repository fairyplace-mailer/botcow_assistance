jest.mock('../src/backend/tools', () => ({
  getToolsSchemas: jest.fn(() => []),
  handleToolCall: jest.fn(),
}));

jest.mock('../src/backend/openai', () => ({
  getOpenAIClient: jest.fn(),
}));

jest.mock('../src/backend/log', () => ({
  logEvent: jest.fn().mockResolvedValue(undefined),
}));

import {
  buildFunctionCallOutputs,
  buildResponsesInput,
  extractFunctionCalls,
  validateResponsesInput,
} from '../src/backend/responses';
import { runAssistant } from '../src/backend/assistant';
import { getOpenAIClient } from '../src/backend/openai';
import { handleToolCall } from '../src/backend/tools';

describe('responses tool loop regressions', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('one function_call produces one function_call_output with same call_id', () => {
    const calls = extractFunctionCalls([
      {
        type: 'function_call',
        id: 'fc_1',
        call_id: 'call_1',
        name: 'github_get_file',
        arguments: '{"path":"README.md"}',
      } as any,
    ]);

    expect(buildFunctionCallOutputs(calls, [{ call_id: 'call_1', output: { ok: true } }])).toEqual([
      {
        type: 'function_call_output',
        call_id: 'call_1',
        output: '{"ok":true}',
      },
    ]);
  });

  test('multiple function calls in one response are all processed', async () => {
    (handleToolCall as jest.Mock)
      .mockResolvedValueOnce({ first: true })
      .mockResolvedValueOnce({ second: true });

    const create = jest
      .fn()
      .mockResolvedValueOnce({
        id: 'resp_1',
        output: [
          {
            type: 'function_call',
            id: 'fc_1',
            call_id: 'call_1',
            name: 'tool_one',
            arguments: '{}',
          },
          {
            type: 'function_call',
            id: 'fc_2',
            call_id: 'call_2',
            name: 'tool_two',
            arguments: '{}',
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 'resp_2',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'done' }],
          },
        ],
        output_text: 'done',
      });

    (getOpenAIClient as jest.Mock).mockReturnValue({
      responses: { create },
    });

    const result = await runAssistant([{ role: 'user', content: 'run tools' }], {
      model: 'gpt-5.4',
      reasoning: { effort: 'none' },
    });

    expect(result.response?.id).toBe('resp_2');
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].input).toEqual([
      { type: 'function_call_output', call_id: 'call_1', output: '{"first":true}' },
      { type: 'function_call_output', call_id: 'call_2', output: '{"second":true}' },
    ]);
  });

  test('follow-up tool request keeps previous_response_id chain', async () => {
    (handleToolCall as jest.Mock).mockResolvedValueOnce({ ok: true });

    const create = jest
      .fn()
      .mockResolvedValueOnce({
        id: 'resp_chain_1',
        output: [
          {
            type: 'function_call',
            id: 'fc_chain_1',
            call_id: 'call_chain_1',
            name: 'tool_one',
            arguments: '{}',
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 'resp_chain_2',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'done' }],
          },
        ],
        output_text: 'done',
      });

    (getOpenAIClient as jest.Mock).mockReturnValue({
      responses: { create },
    });

    await runAssistant([{ role: 'user', content: 'run tool' }], {
      model: 'gpt-5.4',
      reasoning: { effort: 'none' },
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].previous_response_id).toBeUndefined();
    expect(create.mock.calls[1][0].previous_response_id).toBe('resp_chain_1');
    expect(create.mock.calls[1][0].input).toEqual([
      { type: 'function_call_output', call_id: 'call_chain_1', output: '{"ok":true}' },
    ]);
  });

  test('stale call_id is blocked before request', () => {
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
  });

  test('duplicate call_id is blocked', () => {
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
          name: 'tool_two',
          arguments: '{}',
        },
      ] as any),
    ).toThrow('Duplicate function_call call_id in current response cycle: call_dup');
  });

  test('duplicate function_call_output call_id is blocked', () => {
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
      buildFunctionCallOutputs(calls, [
        { call_id: 'call_1', output: { value: 1 } },
        { call_id: 'call_1', output: { value: 2 } },
      ]),
    ).toThrow('Duplicate function_call_output call_id in current response cycle: call_1');
  });

  test('function_call_output is normalized to string', () => {
    const calls = extractFunctionCalls([
      {
        type: 'function_call',
        id: 'fc_1',
        call_id: 'call_1',
        name: 'tool_one',
        arguments: '{}',
      } as any,
    ]);

    const outputs = buildFunctionCallOutputs(calls, [{ call_id: 'call_1', output: { value: 1 } }]);
    expect(outputs[0]).toEqual({
      type: 'function_call_output',
      call_id: 'call_1',
      output: '{"value":1}',
    });
  });

  test('validator blocks output_text in input message content', () => {
    expect(() =>
      validateResponsesInput([
        {
          role: 'assistant',
          content: [{ type: 'output_text', text: 'bad' }],
        } as any,
      ]),
    ).toThrow('Responses payload validation failed: unsupported input content type output_text');
  });

  test('buildResponsesInput keeps input_text only in actual input messages', () => {
    const built = buildResponsesInput([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: [{ type: 'output_text', text: 'model reply' }] },
    ]);

    expect(built.instructions).toBe('sys');
    expect(built.input).toEqual([
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'hello' }],
      },
    ]);
  });
});
