jest.mock('../src/backend/openai', () => ({
  getOpenAIClient: jest.fn(),
}));

jest.mock('../src/backend/tools', () => ({
  getToolsSchemas: jest.fn(() => []),
  handleToolCall: jest.fn(),
}));

jest.mock('../src/backend/log', () => ({
  logEvent: jest.fn().mockResolvedValue(undefined),
  logInfo: jest.fn().mockResolvedValue(undefined),
  logWarn: jest.fn().mockResolvedValue(undefined),
}));

import { resolveReasoningDecision, runAssistant, type ResponsesRuntimeCapabilities } from '../src/backend/assistant';
import { getOpenAIClient } from '../src/backend/openai';
import { logEvent } from '../src/backend/log';
import { OPENAI_SDK_VERSION } from '../src/backend/openaiRuntime';

describe('assistant routing propagation', () => {
  const runtimeSupported: ResponsesRuntimeCapabilities = {
    path: 'openai.responses.create',
    reasoning: 'supported',
    sdkVersion: OPENAI_SDK_VERSION,
    apiBaseUrl: 'https://api.openai.com/v1',
    runtimeKind: 'openai',
  };

  const runtimeUnsupported: ResponsesRuntimeCapabilities = {
    path: 'openai.responses.create',
    reasoning: 'unsupported',
    sdkVersion: OPENAI_SDK_VERSION,
    apiBaseUrl: 'https://api.openai.com/v1',
    runtimeKind: 'openai',
  };

  beforeEach(() => {
    jest.resetAllMocks();
    (logEvent as jest.Mock).mockResolvedValue(undefined);
  });

  test('resolveReasoningDecision keeps reasoning for reasoning-capable model and supported runtime', () => {
    expect(
      resolveReasoningDecision(
        { model: 'gpt-5.4', reasoning: { effort: 'high' } } as any,
        runtimeSupported,
      ),
    ).toEqual({
      requestedReasoningEffort: 'high',
      sentReasoningEffort: 'high',
      reasoningSuppressedReason: null,
    });
  });

  test('resolveReasoningDecision omits reasoning on stateless follow-up path without previous response continuity', () => {
    expect(
      resolveReasoningDecision(
        { model: 'gpt-5.4', reasoning: { effort: 'high' } } as any,
        runtimeSupported,
        {
          stateMode: { kind: 'stateless' },
          pendingInput: [
            {
              type: 'function_call_output',
              call_id: 'call-1',
              output: '{}',
            },
          ] as any,
        },
      ),
    ).toEqual({
      requestedReasoningEffort: 'high',
      sentReasoningEffort: null,
      reasoningSuppressedReason: 'state_path_not_supported',
    });
  });

  test('resolveReasoningDecision omits reasoning when runtime is not supported', () => {
    expect(
      resolveReasoningDecision(
        { model: 'gpt-5.4', reasoning: { effort: 'high' } } as any,
        runtimeUnsupported,
      ),
    ).toEqual({
      requestedReasoningEffort: 'high',
      sentReasoningEffort: null,
      reasoningSuppressedReason: 'runtime_not_supported',
    });
  });

  test.each([
    ['gpt-5.4-mini', 'medium'],
    ['gpt-5.4-nano', 'none'],
  ] as const)('resolveReasoningDecision keeps supported effort for %s', (model, effort) => {
    expect(
      resolveReasoningDecision(
        { model, reasoning: { effort } } as any,
        runtimeSupported,
      ),
    ).toEqual({
      requestedReasoningEffort: effort,
      sentReasoningEffort: effort,
      reasoningSuppressedReason: null,
    });
  });

  test('runAssistant sends reasoning/text/max tokens and logs request contract', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'resp_2',
      model: 'gpt-5.4',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'ok' }],
        },
      ],
      output_text: 'ok',
    });

    (getOpenAIClient as jest.Mock).mockReturnValue({
      responses: { create },
    });

    await runAssistant({
      instructions: 'SYS',
      messages: [{ role: 'user', content: 'hello' }],
      routing: {
        model: 'gpt-5.4',
        reasoning: { effort: 'high' },
        reason: 'deep-code-debug-review',
        text: { verbosity: 'medium' },
        maxOutputTokens: 8000,
      },
      state: {},
    });

    const request = create.mock.calls[0][0];
    expect(request.model).toBe('gpt-5.4');
    expect(request.reasoning).toEqual({ effort: 'high', summary: 'concise' });
    expect(request.text).toEqual({ verbosity: 'medium' });
    expect(request.max_output_tokens).toBe(8000);
    expect(request.parallel_tool_calls).toBe(false);

    expect(logEvent).toHaveBeenCalledWith(
      'openai_request_completed',
      expect.objectContaining({
        path: 'openai.responses.create',
        methodWrapper: 'openai.responses.create',
        model: 'gpt-5.4',
        modelReason: 'deep-code-debug-review',
        requestedReasoningEffort: 'high',
        sentReasoningEffort: 'high',
        reasoningSuppressedReason: null,
        runtimeReasoningSupport: 'supported',
        runtimeKind: 'openai',
        apiBaseUrl: 'https://api.openai.com/v1',
        payloadKeys: expect.arrayContaining(['reasoning', 'text', 'max_output_tokens']),
      }),
    );
  });

  test('runAssistant suppresses reasoning on stateless follow-up when previous_response_id is unavailable', async () => {
    const create = jest
      .fn()
      .mockResolvedValueOnce({
        model: 'gpt-5.4',
        output: [
          {
            type: 'function_call',
            call_id: 'call-1',
            name: 'demo_tool',
            arguments: JSON.stringify({}),
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 'resp-final',
        model: 'gpt-5.4',
        output_text: 'ok',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'ok' }],
          },
        ],
      });

    const { getToolsSchemas, handleToolCall } = require('../src/backend/tools');

    (getToolsSchemas as jest.Mock).mockReturnValue([
      {
        type: 'function',
        name: 'demo_tool',
        description: 'demo',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
          additionalProperties: false,
        },
      },
    ]);
    (handleToolCall as jest.Mock).mockResolvedValue({ ok: true });

    (getOpenAIClient as jest.Mock).mockReturnValue({
      responses: { create },
    });

    await runAssistant({
      instructions: 'SYS',
      messages: [{ role: 'user', content: 'hello' }],
      routing: {
        model: 'gpt-5.4',
        reasoning: { effort: 'high' },
        reason: 'deep-code-debug-review',
      },
      state: {},
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].reasoning).toEqual({ effort: 'high', summary: 'concise' });
    expect(create.mock.calls[1][0].previous_response_id).toBeUndefined();
    expect(create.mock.calls[1][0].conversation).toBeUndefined();
    expect(create.mock.calls[1][0].reasoning).toBeUndefined();

    const matchingLog = (logEvent as jest.Mock).mock.calls.find(
      ([eventName, payload]) =>
        eventName === 'openai_request_completed' &&
        payload?.reasoningSuppressedReason === 'state_path_not_supported',
    );

    expect(matchingLog).toBeDefined();
  });

  test('runAssistant fails explicitly on incomplete responses instead of treating them as empty output', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'resp_incomplete',
      model: 'gpt-5.4',
      status: 'incomplete',
      incomplete_details: {
        reason: 'max_output_tokens',
      },
      output: [],
    });

    (getOpenAIClient as jest.Mock).mockReturnValue({
      responses: { create },
    });

    const result = await runAssistant({
      instructions: 'SYS',
      messages: [{ role: 'user', content: 'debug this repo' }],
      routing: {
        model: 'gpt-5.4',
        reasoning: { effort: 'high' },
        reason: 'deep-code-debug-review',
        text: { verbosity: 'medium' },
        maxOutputTokens: 24000,
      },
      state: {},
    });

    expect(result.error).toEqual(
      expect.objectContaining({
        publicCode: 'assistant_run_failed',
        internalCode: 'response_incomplete',
        responseId: 'resp_incomplete',
      }),
    );
    expect(result.response?.id).toBe('resp_incomplete');
  });

  test('runAssistant retries retryable OpenAI failures and logs retry scheduling', async () => {
    const create = jest
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('rate limited'), {
          status: 429,
          headers: { 'retry-after-ms': '1' },
        }),
      )
      .mockResolvedValueOnce({
        id: 'resp_retry_ok',
        model: 'gpt-5.4',
        output_text: 'ok',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'ok' }],
          },
        ],
      });

    (getOpenAIClient as jest.Mock).mockReturnValue({
      responses: { create },
    });

    const result = await runAssistant({
      instructions: 'SYS',
      messages: [{ role: 'user', content: 'hello' }],
      routing: {
        model: 'gpt-5.4',
        reasoning: { effort: 'high' },
        reason: 'deep-code-debug-review',
      },
      state: {},
    });

    expect(result.error).toBeUndefined();
    expect(create).toHaveBeenCalledTimes(2);
    expect(logEvent).toHaveBeenCalledWith(
      'assistant_openai_retry_scheduled',
      expect.objectContaining({
        attempt: 1,
        nextAttempt: 2,
        status: 429,
        delayMs: 1,
      }),
    );
  });

  test('runAssistant logs supported runtime reasoning behavior', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'resp_3',
      model: 'gpt-5.4',
      output_text: 'ok',
      output: [],
    });

    (getOpenAIClient as jest.Mock).mockReturnValue({
      responses: { create },
    });

    await runAssistant({
      instructions: 'SYS',
      messages: [{ role: 'user', content: 'hello' }],
      routing: {
        model: 'gpt-5.4',
        reasoning: { effort: 'high' },
        reason: 'deep-code-debug-review',
      },
      state: {},
    });

    expect(logEvent).toHaveBeenCalledWith(
      'openai_request_completed',
      expect.objectContaining({
        requestedReasoningEffort: 'high',
        sentReasoningEffort: 'high',
        reasoningSuppressedReason: null,
        runtimeReasoningSupport: 'supported',
      }),
    );
  });
});
