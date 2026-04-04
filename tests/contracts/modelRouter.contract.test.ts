import { describe, expect, it } from '@jest/globals';

import { chooseModel } from '../../src/backend/modelRouter';

describe('modelRouter contract', () => {
  it('forces full/high for golden-core self-rewrite', () => {
    const result = chooseModel(
      [{ role: 'user', content: 'Rewrite the core runtime safely.' }],
      { touchedFiles: ['src/backend/assistant.ts'] },
    );

    expect(result.model).toBe('gpt-5.4');
    expect(result.reasoning?.effort).toBe('high');
    expect(result.reason).toBe('golden-core-self-rewrite');
  });

  it('allows nano only for lightweight classification-like tasks', () => {
    const result = chooseModel([
      { role: 'user', content: 'Classify this issue into one label. Return JSON only.' },
    ]);

    expect(['gpt-5.4-nano', 'gpt-5.4-mini']).toContain(result.model);
    expect(['none', 'low']).toContain(result.reasoning?.effort ?? 'none');
  });
});
