jest.mock('../src/backend/assistant', () => ({
  runAssistant: jest.fn(),
}));

jest.mock('../src/backend/log', () => ({
  logEvent: jest.fn(),
}));

jest.mock('../src/backend/orchestrator/planAssistantTurn', () => ({
  planAssistantTurn: jest.fn(),
}));

import { POST } from '../src/app/api/chat/route';
import { runAssistant } from '../src/backend/assistant';
import { logEvent } from '../src/backend/log';
import { planAssistantTurn } from '../src/backend/orchestrator/planAssistantTurn';

describe('chat route routing contract', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('passes canonical params to runAssistant via orchestrator and returns normalized public success contract', async () => {
    const plan = {
      normalizedHints: {
        toolHeavy: true,
        multiFileIntent: false,
        longContextSize: 19,
      },
      routing: {
        model: 'gpt-5.4',
        reasoning: { effort: 'high' },
        reason: 'deep-code-debug-review',
      },
      execution: {
        model: 'gpt-5.4',
        reasoningEffort: 'high',
        responseVerbosity: 'medium',
        maxOutputTokens: 8000,
        toolUsePolicy: 'tool_first',
      },
      instructions: 'CORE_INSTRUCTIONS',
      run: {
        model: 'gpt-5.4',
        reasoning: { effort: 'high' },
        reason: 'deep-code-debug-review',
        text: { verbosity: 'medium' },
        maxOutputTokens: 8000,
      },
    };

    (planAssistantTurn as jest.Mock).mockReturnValue(plan);
    (runAssistant as jest.Mock).mockResolvedValue({
      response: {
        id: 'resp_1',
        model: 'gpt-5.4',
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
        previousResponseId: 'resp_1',
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
        state: { previousResponseId: 'resp_prev' },
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(planAssistantTurn).toHaveBeenCalledWith({
      messages: [{ role: 'user', content: 'analyze stack trace' }],
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
      state: { previousResponseId: 'resp_prev' },
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
        previousResponseId: 'resp_1',
        toolCalls: 0,
      }),
    );
  });

  test('creates session id when header absent', async () => {
    const plan = {
      normalizedHints: {
        multiFileIntent: false,
        longContextSize: 5,
      },
      routing: {
        model: 'gpt-5.4-mini',
        reasoning: { effort: 'low' },
        reason: 'short-general-request',
      },
      execution: {
        model: 'gpt-5.4-mini',
        reasoningEffort: 'low',
        responseVerbosity: 'low',
        maxOutputTokens: 4000,
        toolUsePolicy: 'normal',
      },
      instructions: 'CORE_INSTRUCTIONS',
      run: {
        model: 'gpt-5.4-mini',
        reasoning: { effort: 'low' },
        reason: 'short-general-request',
        text: { verbosity: 'low' },
        maxOutputTokens: 4000,
      },
    };

    (planAssistantTurn as jest.Mock).mockReturnValue(plan);
    (runAssistant as jest.Mock).mockResolvedValue({
      response: {
        id: 'resp_2',
        model: 'gpt-5.4-mini',
        output_text: 'hello',
      },
      toolCalls: [],
      reasoningDecision: {
        requestedReasoningEffort: 'low',
        sentReasoningEffort: 'low',
        reasoningSuppressedReason: null,
      },
      state: {
        previousResponseId: 'resp_2',
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
      previousResponseId: 'resp_2',
    });
  });

  test('does not expose internal stop reason in production just because the message looks like an audit request', async () => {
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      const plan = {
        normalizedHints: {
          multiFileIntent: false,
          longContextSize: 120,
        },
        routing: {
          model: 'gpt-5.4',
          reasoning: { effort: 'medium' },
          reason: 'repo-audit-or-spec-compliance',
        },
        execution: {
          model: 'gpt-5.4',
          reasoningEffort: 'medium',
          responseVerbosity: 'medium',
          maxOutputTokens: 8000,
          toolUsePolicy: 'tool_first',
        },
        instructions: 'CORE_INSTRUCTIONS',
        run: {
          model: 'gpt-5.4',
          reasoning: { effort: 'medium' },
          reason: 'repo-audit-or-spec-compliance',
          text: { verbosity: 'medium' },
          maxOutputTokens: 8000,
        },
      };

      (planAssistantTurn as jest.Mock).mockReturnValue(plan);
      (runAssistant as jest.Mock).mockResolvedValue({
        response: null,
        toolCalls: [],
        reasoningDecision: {
          requestedReasoningEffort: 'medium',
          sentReasoningEffort: 'medium',
          reasoningSuppressedReason: null,
        },
        state: {
          previousResponseId: null,
        },
        error: {
          publicCode: 'assistant_run_failed',
          publicMessage: 'Не удалось завершить действие автоматически.',
          internalCode: 'tool_loop_limit',
        },
      });

      const res = await POST(
        new Request('http://localhost/api/chat', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-botcow-session-id': 'session_prod_audit',
          },
          body: JSON.stringify({
            messages: [
              {
                role: 'user',
                content:
                  'Work in repo fairyplace-mailer/botcow_assistance branch provecta. Make a full audit against docs/strong_spec.md. Do not change anything.',
              },
            ],
          }),
        }),
      );
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body).toEqual({
        ok: false,
        sessionId: 'session_prod_audit',
        response: null,
        error: {
          code: 'assistant_run_failed',
          message: 'Не удалось завершить действие автоматически.',
        },
      });
    } finally {
      process.env.NODE_ENV = previousEnv;
    }
  });

  test('returns 503 with Retry-After for transient upstream failures', async () => {
    const plan = {
      normalizedHints: {
        multiFileIntent: false,
        longContextSize: 5,
      },
      routing: {
        model: 'gpt-5.4-mini',
        reasoning: { effort: 'low' },
        reason: 'short-general-request',
      },
      execution: {
        model: 'gpt-5.4-mini',
        reasoningEffort: 'low',
        responseVerbosity: 'low',
        maxOutputTokens: 4000,
        toolUsePolicy: 'normal',
      },
      instructions: 'CORE_INSTRUCTIONS',
      run: {
        model: 'gpt-5.4-mini',
        reasoning: { effort: 'low' },
        reason: 'short-general-request',
        text: { verbosity: 'low' },
        maxOutputTokens: 4000,
      },
    };

    (planAssistantTurn as jest.Mock).mockReturnValue(plan);
    (runAssistant as jest.Mock).mockRejectedValue(
      Object.assign(new Error('rate limited'), {
        status: 429,
        headers: { 'retry-after': '7' },
      }),
    );

    const res = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-botcow-session-id': 'session_retryable',
        },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('7');
    expect(body).toEqual({
      ok: false,
      sessionId: 'session_retryable',
      response: null,
      error: {
        code: 'chat_request_failed',
        message: 'Не удалось завершить действие автоматически. [debug: Error]',
      },
    });
  });

  test('rejects client-supplied routing hints', async () => {
    const res = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'hello' }],
          hints: { toolHeavy: true },
        }),
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
    expect(planAssistantTurn).not.toHaveBeenCalled();
    expect(runAssistant).not.toHaveBeenCalled();
  });

  test('rejects empty messages array', async () => {
    const res = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [] }),
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
  });

  test('rejects message with unsupported role', async () => {
    const res = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'tool', content: 'bad' }],
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error?.code).toBe('invalid_messages');
  });

  test('rejects request without single user message', async () => {
    const res = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'assistant', content: 'hello' }],
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error?.code).toBe('invalid_messages');
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
});
