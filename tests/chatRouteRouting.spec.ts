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

import { POST } from '../src/app/api/chat/route';
import { runAssistant } from '../src/backend/assistant';
import { logEvent } from '../src/backend/log';
import { chooseModel } from '../src/backend/modelRouter';

describe('chat route routing contract', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.NODE_ENV = 'test';
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  test('passes full routing object to runAssistant and logs reasoning diagnostics', async () => {
    const routing = {
      model: 'gpt-5.4',
      reasoning: { effort: 'xhigh' },
      reason: 'deep-code-debug-review',
      debug: { matchedRule: 'stack-trace' },
    };

    (chooseModel as jest.Mock).mockReturnValue(routing);
    (runAssistant as jest.Mock).mockResolvedValue({
      response: { id: 'resp_1', model: 'gpt-5.4', output: [], output_text: 'done' },
      completion: null,
      toolCalls: [],
      reasoningDecision: {
        requestedReasoningEffort: 'xhigh',
        sentReasoningEffort: null,
        reasoningSuppressedReason: 'sdk_contract_unknown',
      },
    });

    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'analyze stack trace' }],
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(runAssistant).toHaveBeenCalledTimes(1);
    expect((runAssistant as jest.Mock).mock.calls[0][1]).toEqual(routing);
    expect(logEvent).toHaveBeenCalledWith(
      'chat',
      expect.objectContaining({
        model: 'gpt-5.4',
        modelReason: 'deep-code-debug-review',
        reasoningEffort: 'xhigh',
        requestedReasoningEffort: 'xhigh',
        sentReasoningEffort: null,
        reasoningSuppressedReason: 'sdk_contract_unknown',
        routingDebug: { matchedRule: 'stack-trace' },
      }),
    );
  });

  test('does not include routingDebug in production and keeps no-reasoning case safe', async () => {
    process.env.NODE_ENV = 'production';

    const routing = {
      model: 'gpt-5.4-mini',
      reason: 'short-general-request',
      debug: { matchedRule: 'short' },
    };

    (chooseModel as jest.Mock).mockReturnValue(routing);
    (runAssistant as jest.Mock).mockResolvedValue({
      response: { id: 'resp_2', model: 'gpt-5.4-mini', output: [], output_text: 'done' },
      completion: null,
      toolCalls: [],
      reasoningDecision: {
        requestedReasoningEffort: null,
        sentReasoningEffort: null,
        reasoningSuppressedReason: null,
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
    expect((runAssistant as jest.Mock).mock.calls[0][1]).toEqual(routing);

    const payload = (logEvent as jest.Mock).mock.calls.find(
      (call) => call[0] === 'chat',
    )?.[1];

    expect(payload.model).toBe('gpt-5.4-mini');
    expect(payload.modelReason).toBe('short-general-request');
    expect(payload.reasoningEffort).toBeNull();
    expect(payload.requestedReasoningEffort).toBeNull();
    expect(payload.sentReasoningEffort).toBeNull();
    expect(payload.reasoningSuppressedReason).toBeNull();
    expect('routingDebug' in payload).toBe(false);
  });
});
