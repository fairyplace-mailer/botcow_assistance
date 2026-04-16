import { describe, expect, it } from '@jest/globals';

import { REASONING_ALLOWED_EFFORTS } from '../../src/backend/openaiRuntime';

describe('openaiRuntime contract', () => {
  it('keeps runtime capabilities aligned with current public Responses API', () => {
    expect(REASONING_ALLOWED_EFFORTS['gpt-5.4'].has('xhigh')).toBe(true);
    expect(REASONING_ALLOWED_EFFORTS['gpt-5.4-mini'].has('xhigh')).toBe(true);
    expect(REASONING_ALLOWED_EFFORTS['gpt-5.4-nano'].has('xhigh')).toBe(true);

    expect([...REASONING_ALLOWED_EFFORTS['gpt-5.4-mini']]).toEqual(['none', 'low', 'medium', 'high', 'xhigh']);
    expect([...REASONING_ALLOWED_EFFORTS['gpt-5.4-nano']]).toEqual(['none', 'low', 'medium', 'high', 'xhigh']);
  });
});
