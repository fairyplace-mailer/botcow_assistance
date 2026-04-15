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

  it('forces full/high for replacement-runtime prompt layer files too', () => {
    const result = chooseModel(
      [{ role: 'user', content: 'Refactor the prompt layer carefully.' }],
      { touchedFiles: ['src/backend/prompt/buildCoreInstructions.ts'] },
    );

    expect(result.model).toBe('gpt-5.4');
    expect(result.reasoning?.effort).toBe('high');
    expect(result.reason).toBe('golden-core-self-rewrite');
  });

  it('forces full/high for contracts and guards touched by self-rewrite', () => {
    const result = chooseModel(
      [{ role: 'user', content: 'Update the runtime guard safely.' }],
      { touchedFiles: ['src/backend/guards/toolArgs.ts', 'src/backend/contracts/chat.ts'] },
    );

    expect(result.model).toBe('gpt-5.4');
    expect(result.reasoning?.effort).toBe('high');
    expect(result.reason).toBe('golden-core-self-rewrite');
  });

  it('keeps reasoning disabled for ordinary codegen', () => {
    const result = chooseModel(
      [{ role: 'user', content: 'Refactor this small React component and keep behavior the same.' }],
      { touchedFiles: ['src/components/Button.tsx'] },
    );

    expect(result.reason).toMatch(/codegen|fallback|short-general-request|pm-or-status-or-ci-cd-or-deploy/);
    expect(result.reasoning).toBeUndefined();
  });

  it('allows nano only for lightweight classification-like tasks', () => {
    const result = chooseModel([
      { role: 'user', content: 'Classify this issue into one label. Return JSON only.' },
    ]);

    expect(['gpt-5.4-nano', 'gpt-5.4-mini']).toContain(result.model);
    expect(['none', 'low']).toContain(result.reasoning?.effort ?? 'none');
  });

  it('forces full model and at least medium reasoning for repo-wide strong_spec audits', () => {
    const result = chooseModel([
      {
        role: 'user',
        content:
          'Work in repo fairyplace-mailer/botcow_assistance branch provecta. Make a full audit against docs/strong_spec.md. Check strict mode. Do not change anything.',
      },
    ]);

    expect(result.model).toBe('gpt-5.4');
    expect(['medium', 'high', 'xhigh']).toContain(result.reasoning?.effort ?? 'medium');
    expect(result.reason).toBe('repo-audit-or-spec-compliance');
  });

});
