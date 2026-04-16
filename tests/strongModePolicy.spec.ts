import { shouldUseReasoningByPolicy, STRONG_MODE_REASON_REASONS } from '../src/backend/guards/strongModePolicy';

describe('strongModePolicy', () => {
  test('allows reasoning for task classes that strong_spec expects to use it', () => {
    expect(shouldUseReasoningByPolicy('classification-or-extraction-or-ranking')).toBe(true);
    expect(shouldUseReasoningByPolicy('pm-or-status-or-ci-cd-or-deploy')).toBe(true);
    expect(shouldUseReasoningByPolicy('codegen-or-refactor')).toBe(true);
    expect(shouldUseReasoningByPolicy('codegen-or-refactor-long-or-complex')).toBe(true);
    expect(shouldUseReasoningByPolicy('long-context-general')).toBe(true);
    expect(shouldUseReasoningByPolicy('fallback-high-risk')).toBe(true);
    expect(shouldUseReasoningByPolicy('hard-override-nano-not-allowed-for-risk')).toBe(true);
    expect(shouldUseReasoningByPolicy('golden-core-self-rewrite')).toBe(true);
    expect(shouldUseReasoningByPolicy('repo-audit-or-spec-compliance')).toBe(true);
    expect(shouldUseReasoningByPolicy('source-conflict')).toBe(true);
    expect(shouldUseReasoningByPolicy('deep-code-debug-review')).toBe(true);
    expect(shouldUseReasoningByPolicy('architecture-or-design')).toBe(true);

    expect(shouldUseReasoningByPolicy('no-user-text')).toBe(false);
    expect(shouldUseReasoningByPolicy('short-general-request')).toBe(false);
    expect(shouldUseReasoningByPolicy('fallback-not-risky')).toBe(false);
    expect(shouldUseReasoningByPolicy('unknown-reason')).toBe(false);
  });

  test('reasoning-enabled reason set stays canonical', () => {
    expect([...STRONG_MODE_REASON_REASONS].sort()).toEqual([
      'architecture-or-design',
      'classification-or-extraction-or-ranking',
      'codegen-or-refactor',
      'codegen-or-refactor-long-or-complex',
      'deep-code-debug-review',
      'fallback-high-risk',
      'golden-core-self-rewrite',
      'hard-override-nano-not-allowed-for-risk',
      'long-context-general',
      'pm-or-status-or-ci-cd-or-deploy',
      'repo-audit-or-spec-compliance',
      'source-conflict',
    ]);
  });
});
