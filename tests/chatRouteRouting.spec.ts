jest.mock('../src/backend/assistant', () => ({
  runAssistant: jest.fn(),
}));

jest.mock('../src/backend/log', () => ({
  logEvent: jest.fn(),
}));

jest.mock('../src/backend/modelRouter', () => ({
  chooseModel: jest.fn(),
}));

jest.mock('../src/backend/prompt/buildCoreInstructions', () => ({
  buildCoreInstructions: jest.fn(() => 'CORE_INSTRUCTIONS'),
}));

import { POST } from '../src/app/api/chat/route';
import { runAssistant } from '../src/backend/assistant';
import { logEvent } from '../src/backend/log';
import { chooseModel } from '../src/backend/modelRouter';
import { buildCoreInstructions } from '../src/backend/prompt/buildCoreInstructions';

describe('chat route routing contract', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (buildCoreInstructions as jest.Mock).mockReturnValue('CORE_INSTRUCTIONS');
  });

  test('passes normalized params to runAssistant and returns normalized public success contract', async () => {
    const routing = {
      model: 'gpt-5.4',
      reasoning: { effort: 'high' },
      reason: 'deep-code-debug-review',
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
      toolCalls: [],
      reasoningDecision: {
        requestedReasoningEffort: 'high',
        sentReasoningEffort: 'high',
        reasoningSuppressedReason: null,
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
        hints: { channel: 'web' },
        state: { conversationId: 'conv_prev', previousResponseId: 'resp_prev' },
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(buildCoreInstructions).toHaveBeenCalledWith({
      routing,
      hints: { channel: 'web' },
    });
    expect(runAssistant).toHaveBeenCalledWith({
      instructions: 'CORE_INSTRUCTIONS',
      messages: [{ role: 'user', content: 'analyze stack trace' }],
      routing: {
        model: 'gpt-5.4',
        reasoning: { effort: 'high' },
        reason: 'deep-code-debug-review',
        text: { verbosity: 'medium' },
        maxOutputTokens: 8000,
      },
      state: { conversationId: 'conv_prev', previousResponseId: 'resp_prev' },
    });
    expect(body).toEqual({
      ok: true,
      sessionId: 'session_1',
      response: {
        id: 'resp_1',
        model: 'gpt-5.4',
        phase: 'final_answer',
        outputText: 'done',
        reason: 'deep-code-debug-review',
        reasoningEffort: 'high',
        state: {
          conversationId: 'conv_1',
          previousResponseId: 'resp_1',
        },
      },
      error: null,
    });
    expect(logEvent).toHaveBeenCalledWith(
      'chat_request_completed',
      expect.objectContaining({
        sessionId: 'session_1',
        model: 'gpt-5.4',
        modelReason: 'deep-code-debug-review',
        reasoningEffort: 'high',
        ok: true,
        responseId: 'resp_1',
        conversationId: 'conv_1',
        latestResponseId: 'resp_1',
        toolCalls: 0,
      }),
    );
  });

  test('creates session id when header absent', async () => {
    const routing = {
      model: 'gpt-5.4-mini',
      reason: 'short-general-request',
    };

    (chooseModel as jest.Mock).mockReturnValue(routing);
    (runAssistant as jest.Mock).mockResolvedValue({
      response: {
        id: 'resp_2',
        model: routing.model,
        output_text: 'hello',
      },
      toolCalls: [],
      reasoningDecision: {
        requestedReasoningEffort: null,
        sentReasoningEffort: null,
        reasoningSuppressedReason: null,
      },
      state: {
        conversationId: null,
        latestResponseId: 'resp_2',
      },
    });

    const res = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sessionId).toEqual(expect.any(String));
    expect(body.sessionId.length).toBeGreaterThan(0);
    expect(body.response.state).toEqual({
      conversationId: null,
      previousResponseId: 'resp_2',
    });
  });

  test('returns normalized invalid body error', async () => {
    const res = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bad: true }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({
      ok: false,
      sessionId: expect.any(String),
      response: null,
      error: {
        code: 'invalid_messages',
        message: 'Invalid messages.',
      },
    });
    expect(runAssistant).not.toHaveBeenCalled();
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

    const res = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-botcow-session-id': 'session_err',
        },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
      }),
    );
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
