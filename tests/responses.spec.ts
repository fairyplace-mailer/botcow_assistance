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
  buildResponsesCreateParams,
  buildResponsesInput,
  createModelResponse,
  extractFinalAssistantMessage,
  extractFunctionCalls,
  makeFunctionCallOutputItem,
  validateResponsesInput,
} from '../src/backend/responses';
import { OPENAI_SDK_VERSION } from '../src/backend/openaiRuntime';

describe('responses helpers', () => {
  test('buildResponsesCreateParams sends conversation state only when conversation mode selected', () => {
    const built = buildResponsesCreateParams({
      model: 'gpt-5.4',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }] as any,
      state: { kind: 'conversation', conversation: { id: 'conv-1' } },
      tools: [],
    });

    expect(built.conversation).toEqual({ id: 'conv-1' });
    expect((built as any).previous_response_id).toBeUndefined();
    expect(built.parallel_tool_calls).toBe(false);
  });

  test('buildResponsesCreateParams sends previous_response_id only when previous_response mode selected', () => {
    const built = buildResponsesCreateParams({
      model: 'gpt-5.4',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }] as any,
      state: { kind: 'previous_response', previousResponseId: 'resp-1' },
      tools: [],
    });

    expect((built as any).previous_response_id).toBe('resp-1');
    expect((built as any).conversation).toBeUndefined();
    expect(built.parallel_tool_calls).toBe(false);
  });

  test('buildResponsesCreateParams stays stateless when no state mode provided', () => {
    const built = buildResponsesCreateParams({
      model: 'gpt-5.4',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }] as any,
      tools: [],
    });

    expect((built as any).previous_response_id).toBeUndefined();
    expect((built as any).conversation).toBeUndefined();
    expect(built.parallel_tool_calls).toBe(false);
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

  test('createModelResponse forwards state mode to sdk request', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'resp' });
    const client = { responses: { create } } as any;

    await createModelResponse({
      client,
      model: 'gpt-5.4',
      instructions: 'DEV_INSTR',
      state: { kind: 'previous_response', previousResponseId: 'resp_prev' },
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
