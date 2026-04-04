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

  test('runAssistant does not send reasoning when runtime support is disabled', async () => {
    process.env.OPENAI_RESPONSES_REASONING = '0';

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

    const request = create.mock.calls[0][0];
    expect(Object.prototype.hasOwnProperty.call(request, 'reasoning')).toBe(false);
    process.env.OPENAI_RESPONSES_REASONING = '1';
  });
});
