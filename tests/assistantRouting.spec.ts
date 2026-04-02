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

describe('assistant routing propagation', () => {
  const runtimeSupported: ResponsesRuntimeCapabilities = {
    path: 'openai.responses.create',
    reasoning: 'supported',
    sdkVersion: '6.16.0',
  };

  const runtimeUnsupported: ResponsesRuntimeCapabilities = {
    path: 'openai.responses.create',
    reasoning: 'unsupported',
    sdkVersion: '6.16.0',
  };

  beforeEach(() => {
    jest.resetAllMocks();
    (logEvent as jest.Mock).mockResolvedValue(undefined);
  });

  test('responses.create sends reasoning for reasoning-capable model and runtime', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'resp_1',
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

    const built = buildResponsesRequest(
      [{ role: 'user', content: 'debug this stack trace' }],
      { model: 'gpt-5.4', reasoning: { effort: 'xhigh' } },
      runtimeSupported,
    );

    expect(built.request.reasoning).toEqual({ effort: 'xhigh' });

    await runAssistant(
      [{ role: 'user', content: 'debug this stack trace' }],
      { model: 'gpt-5.4', reasoning: { effort: 'xhigh' } },
    );

    const request = create.mock.calls[0][0];
    expect(request.model).toBe('gpt-5.4');
    expect(Object.prototype.hasOwnProperty.call(request, 'reasoning')).toBe(false);
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

  test('responses.create omits reasoning when model is not confirmed as reasoning-capable', () => {
    const built = buildResponsesRequest(
      [{ role: 'user', content: 'hello' }],
      { model: 'gpt-5.4-nano', reasoning: { effort: 'high' } },
      runtimeSupported,
    );

    expect(built.reasoningDecision).toEqual({
      requestedReasoningEffort: 'high',
      sentReasoningEffort: null,
      reasoningSuppressedReason: 'model_not_supported',
    });
    expect(Object.prototype.hasOwnProperty.call(built.request, 'reasoning')).toBe(false);
  });

  test('logs model, requested effort, sent effort and suppression reason', async () => {
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
        model: 'gpt-5.4',
        requestedReasoningEffort: 'high',
        sentReasoningEffort: null,
        reasoningSuppressedReason: 'sdk_contract_unknown',
      }),
    );
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
