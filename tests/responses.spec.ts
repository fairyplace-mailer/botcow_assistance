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
import {
  buildResponsesRequest,
  getResponsesRuntimeCapabilities,
  resolveReasoningDecision,
  runAssistant,
  supportsReasoning,
  type ResponsesRuntimeCapabilities,
} from '../src/backend/assistant';
import { OPENAI_SDK_VERSION } from '../src/backend/openaiRuntime';
import { getOpenAIClient } from '../src/backend/openai';
import { logEvent } from '../src/backend/log';
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

  test('supportsReasoning returns true only for supported model and runtime path', () => {
    const supportedRuntime: ResponsesRuntimeCapabilities = {
      path: 'openai.responses.create',
      reasoning: 'supported',
      sdkVersion: OPENAI_SDK_VERSION,
    };

    const currentRuntime = getResponsesRuntimeCapabilities();

    expect(supportsReasoning('gpt-5.4', supportedRuntime)).toBe(true);
    expect(supportsReasoning('gpt-5.4-mini', supportedRuntime)).toBe(false);
    expect(supportsReasoning('gpt-5.4-nano', supportedRuntime)).toBe(false);
    expect(supportsReasoning('gpt-5.4', currentRuntime)).toBe(currentRuntime.reasoning === 'supported');
  });

  test('responses.create is called with reasoning when model and runtime support it', () => {
    const built = buildResponsesRequest(
      [{ role: 'user', content: 'hello' }],
      { model: 'gpt-5.4', reasoning: { effort: 'low' } },
      {
        path: 'openai.responses.create',
        reasoning: 'supported',
        sdkVersion: OPENAI_SDK_VERSION,
      },
    );

    expect(built.reasoningDecision).toEqual({
      requestedReasoningEffort: 'low',
      sentReasoningEffort: 'low',
      reasoningSuppressedReason: null,
    });
    expect(built.request.reasoning).toEqual({ effort: 'low' });
  });

  test('supported case includes exact reasoning key in payload', () => {
    const built = buildResponsesRequest(
      [{ role: 'user', content: 'hello' }],
      { model: 'gpt-5.4', reasoning: { effort: 'low' } },
      {
        path: 'openai.responses.create',
        reasoning: 'supported',
        sdkVersion: OPENAI_SDK_VERSION,
      },
    );

    expect(Object.keys(built.request).sort()).toEqual(['input', 'model', 'reasoning', 'tools']);
    expect(Object.prototype.hasOwnProperty.call(built.request, 'reasoning')).toBe(true);
  });

  test('responses.create is called without reasoning when model is not supported', () => {
    const built = buildResponsesRequest(
      [{ role: 'user', content: 'hello' }],
      { model: 'gpt-5.4-mini', reasoning: { effort: 'low' } },
      {
        path: 'openai.responses.create',
        reasoning: 'supported',
        sdkVersion: OPENAI_SDK_VERSION,
      },
    );

    expect(built.reasoningDecision).toEqual({
      requestedReasoningEffort: 'low',
      sentReasoningEffort: null,
      reasoningSuppressedReason: 'model_not_supported',
    });
    expect('reasoning' in built.request).toBe(false);
  });

  test('responses.create is called without reasoning when runtime is not confirmed', () => {
    const built = buildResponsesRequest(
      [{ role: 'user', content: 'hello' }],
      { model: 'gpt-5.4', reasoning: { effort: 'low' } },
      {
        path: 'openai.responses.create',
        reasoning: 'unknown',
        sdkVersion: OPENAI_SDK_VERSION,
      },
    );

    expect(built.reasoningDecision).toEqual({
      requestedReasoningEffort: 'low',
      sentReasoningEffort: null,
      reasoningSuppressedReason: 'sdk_contract_unknown',
    });
    expect('reasoning' in built.request).toBe(false);
  });

  test('unsupported case omits reasoning key from exact payload keys', () => {
    const built = buildResponsesRequest(
      [{ role: 'user', content: 'hello' }],
      { model: 'gpt-5.4', reasoning: { effort: 'low' } },
      {
        path: 'openai.responses.create',
        reasoning: 'unsupported',
        sdkVersion: OPENAI_SDK_VERSION,
      },
    );

    expect(Object.keys(built.request).sort()).toEqual(['input', 'model', 'tools']);
    expect(Object.prototype.hasOwnProperty.call(built.request, 'reasoning')).toBe(false);
  });

  test('request builder does not send reasoning key when effort is absent', () => {
    const built = buildResponsesRequest(
      [{ role: 'user', content: 'hello' }],
      { model: 'gpt-5.4', reasoning: undefined },
      {
        path: 'openai.responses.create',
        reasoning: 'supported',
        sdkVersion: OPENAI_SDK_VERSION,
      },
    );

    expect(built.reasoningDecision).toEqual({
      requestedReasoningEffort: null,
      sentReasoningEffort: null,
      reasoningSuppressedReason: null,
    });
    expect(Object.prototype.hasOwnProperty.call(built.request, 'reasoning')).toBe(false);
    expect((built.request as Record<string, unknown>).reasoning).toBeUndefined();
  });

  test('resolveReasoningDecision returns runtime_not_supported for unsupported path capability', () => {
    expect(
      resolveReasoningDecision(
        { model: 'gpt-5.4', reasoning: { effort: 'low' } },
        {
          path: 'openai.responses.create',
          reasoning: 'unsupported',
          sdkVersion: OPENAI_SDK_VERSION,
        },
      ),
    ).toEqual({
      requestedReasoningEffort: 'low',
      sentReasoningEffort: null,
      reasoningSuppressedReason: 'runtime_not_supported',
    });
  });

  test('logging includes model requested effort sent effort suppression reason and reasoning flags', async () => {
    const create = jest.fn().mockResolvedValueOnce({
      id: 'resp_log_1',
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

    await runAssistant([{ role: 'user', content: 'hello' }], {
      model: 'gpt-5.4',
      reasoning: { effort: 'low' },
    });

    const runtime = getResponsesRuntimeCapabilities();
    const expectedSent = runtime.reasoning === 'supported' ? 'low' : null;
    const expectedSuppressedReason = runtime.reasoning === 'supported' ? null : 'sdk_contract_unknown';
    const expectedHasReasoningKey = runtime.reasoning === 'supported';
    const expectedReasoningPayload = runtime.reasoning === 'supported' ? { effort: 'low' } : null;
    const payloadKeys = runtime.reasoning === 'supported'
      ? expect.arrayContaining(['reasoning'])
      : expect.not.arrayContaining(['reasoning']);

    expect(logEvent).toHaveBeenCalledWith(
      'openai-request',
      expect.objectContaining({
        model: 'gpt-5.4',
        requestedReasoningEffort: 'low',
        sentReasoningEffort: expectedSent,
        reasoningSuppressedReason: expectedSuppressedReason,
        hasReasoningKey: expectedHasReasoningKey,
        reasoningPayload: expectedReasoningPayload,
        payloadKeys,
      }),
    );
  });

  test('regression: unsupported runtime no longer sends reasoning key', () => {
    const built = buildResponsesRequest(
      [{ role: 'user', content: 'hello' }],
      { model: 'gpt-5.4', reasoning: { effort: 'low' } },
      {
        path: 'openai.responses.create',
        reasoning: 'unsupported',
        sdkVersion: OPENAI_SDK_VERSION,
      },
    );

    expect(built.reasoningDecision).toEqual({
      requestedReasoningEffort: 'low',
      sentReasoningEffort: null,
      reasoningSuppressedReason: 'runtime_not_supported',
    });
    expect(built.request).toEqual(
      expect.not.objectContaining({
        reasoning: expect.anything(),
      }),
    );
    expect('reasoning' in built.request).toBe(false);
  });
});
