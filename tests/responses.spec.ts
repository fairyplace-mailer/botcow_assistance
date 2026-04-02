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

  test('validator blocks input_text in assistant output context regression', () => {
    expect(() =>
      validateResponsesInput([
        {
          role: 'assistant',
          content: [{ type: 'output_text', text: 'bad' }],
        } as any,
      ]),
    ).toThrow('Responses payload validation failed: unsupported input content type output_text');
  });

  test('buildResponsesInput keeps input_text only in input messages', () => {
    const built = buildResponsesInput([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
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
