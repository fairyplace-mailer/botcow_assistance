jest.mock('../src/backend/openai', () => ({
  getOpenAIClient: jest.fn(),
}));

jest.mock('../src/backend/tools', () => ({
  getToolsSchemas: jest.fn(() => []),
  handleToolCall: jest.fn(),
}));

jest.mock('../src/backend/log', () => ({
  logEvent: jest.fn().mockResolvedValue(undefined),
}));

import {
  buildResponsesRequest,
  runAssistant,
  type ResponsesRuntimeCapabilities,
} from '../src/backend/assistant';
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

  test('responses.create sends reasoning for reasoning-capable model and supported runtime', () => {
    const built = buildResponsesRequest(
      [{ role: 'user', content: 'debug this stack trace' }],
      { model: 'gpt-5.4', reasoning: { effort: 'xhigh' } },
      runtimeSupported,
    );

    expect(built.request.model).toBe('gpt-5.4');
    expect(built.request.reasoning).toEqual({ effort: 'xhigh' });
    expect(built.reasoningDecision).toEqual({
      requestedReasoningEffort: 'xhigh',
      sentReasoningEffort: 'xhigh',
      reasoningSuppressedReason: null,
    });
  });

  test('responses.create omits reasoning when runtime is not supported', () => {
    const built = buildResponsesRequest(
      [{ role: 'user', content: 'hello' }],
      { model: 'gpt-5.4', reasoning: { effort: 'high' } },
      runtimeUnsupported,
    );

    expect(built.reasoningDecision).toEqual({
      requestedReasoningEffort: 'high',
      sentReasoningEffort: null,
      reasoningSuppressedReason: 'runtime_not_supported',
    });
    expect(Object.prototype.hasOwnProperty.call(built.request, 'reasoning')).toBe(false);
  });

  test.each([
    ['gpt-5.4-mini', 'medium'],
    ['gpt-5.4-nano', 'none'],
  ] as const)('responses.create sends reasoning for %s when runtime is supported', (model, effort) => {
    const built = buildResponsesRequest(
      [{ role: 'user', content: 'hello' }],
      { model, reasoning: { effort } },
      runtimeSupported,
    );

    expect(built.reasoningDecision).toEqual({
      requestedReasoningEffort: effort,
      sentReasoningEffort: effort,
      reasoningSuppressedReason: null,
    });
    expect(built.request.reasoning).toEqual({ effort });
  });

  test('runAssistant logs model, requested effort, sent effort and suppression reason', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'resp_2',
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

    await runAssistant(
      [{ role: 'user', content: 'hello' }],
      { model: 'gpt-5.4', reasoning: { effort: 'high' } },
    );

    expect(logEvent).toHaveBeenCalledWith(
      'openai-request',
      expect.objectContaining({
        path: 'openai.responses.create',
        methodWrapper: 'openai.responses.create',
        model: 'gpt-5.4',
        requestedReasoningEffort: 'high',
        sentReasoningEffort: 'high',
        reasoningSuppressedReason: null,
        runtimeReasoningSupport: 'supported',
        runtimeKind: 'openai',
        apiBaseUrl: 'https://api.openai.com/v1',
        payloadKeys: expect.arrayContaining(['reasoning']),
      }),
    );

    const requestLogPayload = (logEvent as jest.Mock).mock.calls.find(
      ([eventName]) => eventName === 'openai-request',
    )?.[1];

    expect(requestLogPayload).toBeDefined();
    expect(requestLogPayload.sdkVersion === null || typeof requestLogPayload.sdkVersion === 'string').toBe(true);

    const request = create.mock.calls[0][0];
    expect(request.model).toBe('gpt-5.4');
    expect(request.reasoning).toEqual({ effort: 'high' });
  });

  test('regression: unsupported reasoning path no longer builds payload with reasoning key', () => {
    const built = buildResponsesRequest(
      [{ role: 'user', content: 'analyze stack trace' }],
      { model: 'gpt-5.4', reasoning: { effort: 'xhigh' } },
      runtimeUnsupported,
    );

    expect(Object.keys(built.request).sort()).toEqual(['input', 'model', 'tools']);
    expect(built.reasoningDecision.reasoningSuppressedReason).toBe('runtime_not_supported');
  });
});
