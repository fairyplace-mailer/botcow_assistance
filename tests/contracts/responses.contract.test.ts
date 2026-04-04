import { describe, expect, it } from '@jest/globals';

import { normalizePublicChatError } from '../../src/backend/responses';

describe('responses contract', () => {
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
