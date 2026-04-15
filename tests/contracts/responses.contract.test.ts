import { describe, expect, it } from '@jest/globals';

import { normalizePublicChatError } from '../../src/backend/responses';

describe('responses contract', () => {

  it('uses delivered reasoning effort when runtime suppresses requested reasoning', () => {
    const { normalizePublicChatSuccess } = require('../../src/backend/responses');

    const result = normalizePublicChatSuccess({
      sessionId: 's2',
      response: {
        id: 'resp_2',
        model: 'gpt-5.4',
        output_text: 'ok',
      },
      routing: {
        model: 'gpt-5.4',
        reasoning: { effort: 'high' },
        reason: 'deep-code-debug-review',
      },
      deliveredReasoningEffort: null,
      state: {
        conversationId: null,
        previousResponseId: 'resp_2',
      },
    });

    expect(result.response.reasoningEffort).toBeNull();
  });

  it('returns normalized public errors', () => {
    const result = normalizePublicChatError({
      sessionId: 's1',
      code: 'assistant_run_failed',
      message: 'Chat request failed.',
    });

    expect(result).toEqual({
      ok: false,
      sessionId: 's1',
      response: null,
      error: {
        code: 'assistant_run_failed',
        message: 'Chat request failed.',
      },
    });
  });
});
