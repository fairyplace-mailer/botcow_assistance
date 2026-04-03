jest.mock('../src/backend/assistant', () => ({
  runAssistant: jest.fn(),
}));

jest.mock('../src/backend/log', () => ({
  logEvent: jest.fn(),
}));

jest.mock('../src/backend/modelRouter', () => ({
  chooseModel: jest.fn(),
}));

jest.mock('../src/backend/devWixDocs/retrieve', () => ({
  retrieveDevWixContext: jest.fn(),
  formatDevWixContext: jest.fn(() => null),
}));

jest.mock('../src/backend/conversationState', () => ({
  getConversationState: jest.fn(),
  saveConversationState: jest.fn(),
}));

import { POST } from '../src/app/api/chat/route';
import { runAssistant } from '../src/backend/assistant';
import { logEvent } from '../src/backend/log';
import { chooseModel } from '../src/backend/modelRouter';
import {
  getConversationState,
  saveConversationState,
} from '../src/backend/conversationState';

describe('chat route routing contract', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.NODE_ENV = 'test';
    (getConversationState as jest.Mock).mockResolvedValue(null);
    (saveConversationState as jest.Mock).mockResolvedValue(undefined);
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  test('passes normalized params to runAssistant and logs reasoning diagnostics', async () => {
    const routing = {
      model: 'gpt-5.4',
      reasoning: { effort: 'xhigh' },
      reason: 'deep-code-debug-review',
      debug: { matchedRule: 'stack-trace' },
    };

    (chooseModel as jest.Mock).mockReturnValue(routing);
    (runAssistant as jest.Mock).mockResolvedValue({
      response: {
        id: 'resp_1',
        model: routing.model,
        output: [
          {
            type: 'message',
            role: 'assistant',
            phase: 'final_answer',
            content: [{ type: 'output_text', text: 'done' }],
          },
        ],
      },
      completion: null,
      toolCalls: [],
      reasoningDecision: {
        requestedReasoningEffort: 'xhigh',
        sentReasoningEffort: null,
        reasoningSuppressedReason: 'sdk_contract_unknown',
      },
      state: {
        conversationId: 'conv_1',
        latestResponseId: 'resp_1',
      },
    });

    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-botcow-session-id': 'session_1',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'analyze stack trace' }],
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      sessionId: 'session_1',
      response: {
        id: 'resp_1',
        model: routing.model,
        phase: 'final_answer',
        outputText: 'done',
      },
      error: null,
    });
    expect(runAssistant).toHaveBeenCalledTimes(1);
    expect(runAssistant).toHaveBeenCalledWith({
      instructions: expect.any(String),
      userInput: 'analyze stack trace',
      routing,
      state: {
        conversationId: undefined,
      },
    });
    expect(saveConversationState).toHaveBeenCalledWith({
      sessionId: 'session_1',
      conversationId: 'conv_1',
      latestResponseId: 'resp_1',
    });
    expect(logEvent).toHaveBeenCalledWith(
      'chat_request_completed',
      expect.objectContaining({
        sessionId: 'session_1',
        model: routing.model,
        modelReason: 'deep-code-debug-review',
        reasoningEffort: 'xhigh',
        requestedReasoningEffort: 'xhigh',
        sentReasoningEffort: null,
        reasoningSuppressedReason: 'sdk_contract_unknown',
        routingDebug: { matchedRule: 'stack-trace' },
        conversationId: 'conv_1',
        auxiliaryLatestResponseId: null,
        responseId: 'resp_1',
      }),
    );
  });

  test('uses persisted conversationId and keeps latestResponseId auxiliary only', async () => {
    const routing = {
      model: 'gpt-5.4-mini',
      reason: 'short-general-request',
      debug: { matchedRule: 'short' },
    };

    (chooseModel as jest.Mock).mockReturnValue(routing);
    (getConversationState as jest.Mock).mockResolvedValue({
      sessionId: 'session_2',
      conversationId: 'conv_persisted',
      latestResponseId: 'resp_old',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    });
    (runAssistant as jest.Mock).mockResolvedValue({
      response: {
        id: 'resp_2',
        model: routing.model,
        output: [
          {
            type: 'message',
            role: 'assistant',
            phase: 'final_answer',
            content: [{ type: 'output_text', text: 'done' }],
          },
        ],
      },
      completion: null,
      toolCalls: [],
      reasoningDecision: {
        requestedReasoningEffort: null,
        sentReasoningEffort: null,
        reasoningSuppressedReason: null,
      },
      state: {
        conversationId: 'conv_next',
        latestResponseId: 'resp_2',
      },
    });

    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-botcow-session-id': 'session_2',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      sessionId: 'session_2',
      response: {
        id: 'resp_2',
        model: routing.model,
        phase: 'final_answer',
        outputText: 'done',
      },
      error: null,
    });
    expect(runAssistant).toHaveBeenCalledWith({
      instructions: expect.any(String),
      userInput: 'hello',
      routing,
      state: {
        conversationId: 'conv_persisted',
      },
    });
    expect(saveConversationState).toHaveBeenCalledWith({
      sessionId: 'session_2',
      conversationId: 'conv_next',
      latestResponseId: 'resp_2',
    });

    const payload = (logEvent as jest.Mock).mock.calls.find(
      (call) => call[0] === 'chat_request_completed',
    )?.[1];

    expect(payload.model).toBe(routing.model);
    expect(payload.modelReason).toBe('short-general-request');
    expect(payload.reasoningEffort).toBeNull();
    expect(payload.requestedReasoningEffort).toBeNull();
    expect(payload.sentReasoningEffort).toBeNull();
    expect(payload.reasoningSuppressedReason).toBeNull();
    expect(payload.auxiliaryLatestResponseId).toBe('resp_old');
    expect(payload.routingDebug).toEqual({ matchedRule: 'short' });
  });

  test('returns normalized public success contract', async () => {
    const routing = {
      model: 'gpt-5.4-mini',
      reason: 'short-general-request',
    };

    (chooseModel as jest.Mock).mockReturnValue(routing);
    (runAssistant as jest.Mock).mockResolvedValue({
      response: {
        id: 'resp_adapter',
        model: routing.model,
        output: [
          {
            type: 'message',
            role: 'assistant',
            phase: 'final_answer',
            content: [{ type: 'output_text', text: 'adapter text' }],
          },
        ],
      },
      completion: null,
      toolCalls: [],
      reasoningDecision: {
        requestedReasoningEffort: null,
        sentReasoningEffort: null,
        reasoningSuppressedReason: null,
      },
      state: {
        conversationId: 'conv_adapter',
        latestResponseId: 'resp_adapter',
      },
    });

    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      sessionId: expect.stringMatching(/^s_/),
      response: {
        id: 'resp_adapter',
        model: routing.model,
        phase: 'final_answer',
        outputText: 'adapter text',
      },
      error: null,
    });
  });

  test('does not include routingDebug in production', async () => {
    process.env.NODE_ENV = 'production';

    const routing = {
      model: 'gpt-5.4-mini',
      reason: 'short-general-request',
      debug: { matchedRule: 'short' },
    };

    (chooseModel as jest.Mock).mockReturnValue(routing);
    (runAssistant as jest.Mock).mockResolvedValue({
      response: {
        id: 'resp_3',
        model: routing.model,
        output: [
          {
            type: 'message',
            role: 'assistant',
            phase: 'final_answer',
            content: [{ type: 'output_text', text: 'done' }],
          },
        ],
      },
      completion: null,
      toolCalls: [],
      reasoningDecision: {
        requestedReasoningEffort: null,
        sentReasoningEffort: null,
        reasoningSuppressedReason: null,
      },
      state: {
        conversationId: null,
        latestResponseId: 'resp_3',
      },
    });

    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(200);

    const payload = (logEvent as jest.Mock).mock.calls.find(
      (call) => call[0] === 'chat_request_completed',
    )?.[1];

    expect(payload.model).toBe(routing.model);
    expect('routingDebug' in payload).toBe(false);
  });

  test('external error is normalized without internal text and keeps sessionId', async () => {
    const routing = {
      model: 'gpt-5.4-mini',
      reason: 'short-general-request',
    };

    (chooseModel as jest.Mock).mockReturnValue(routing);
    (runAssistant as jest.Mock).mockResolvedValue({
      response: {
        id: 'resp_err',
        model: routing.model,
        output: [],
      },
      completion: null,
      toolCalls: [],
      reasoningDecision: {
        requestedReasoningEffort: null,
        sentReasoningEffort: null,
        reasoningSuppressedReason: null,
      },
      state: {
        conversationId: null,
        latestResponseId: 'resp_err',
      },
      error: {
        publicCode: 'assistant_run_failed',
        publicMessage: 'Не удалось завершить действие автоматически. Попробуйте ещё раз.',
        internalCode: 'tool_timeout',
      },
    });

    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-botcow-session-id': 'session_err',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({
      ok: false,
      sessionId: 'session_err',
      response: null,
      error: {
        code: 'assistant_run_failed',
        message: 'Не удалось завершить действие автоматически. Попробуйте ещё раз.',
      },
    });
    expect(JSON.stringify(body)).not.toContain('tool_timeout');
  });
});
