import { shouldUseReasoningByPolicy, STRONG_MODE_REASON_REASONS } from '../src/backend/guards/strongModePolicy';

describe('strongModePolicy', () => {
  test('allows reasoning only for strong-mode reasons', () => {
    expect(shouldUseReasoningByPolicy('golden-core-self-rewrite')).toBe(true);
    expect(shouldUseReasoningByPolicy('repo-audit-or-spec-compliance')).toBe(true);
    expect(shouldUseReasoningByPolicy('source-conflict')).toBe(true);
    expect(shouldUseReasoningByPolicy('deep-code-debug-review')).toBe(true);
    expect(shouldUseReasoningByPolicy('architecture-or-design')).toBe(true);

    expect(shouldUseReasoningByPolicy('codegen-or-refactor')).toBe(false);
    expect(shouldUseReasoningByPolicy('pm-or-status-or-ci-cd-or-deploy')).toBe(false);
    expect(shouldUseReasoningByPolicy('short-general-request')).toBe(false);
    expect(shouldUseReasoningByPolicy('fallback-not-risky')).toBe(false);
  });

  test('strong-mode reason set stays canonical', () => {
    expect([...STRONG_MODE_REASON_REASONS].sort()).toEqual([
      'architecture-or-design',
      'deep-code-debug-review',
      'golden-core-self-rewrite',
      'repo-audit-or-spec-compliance',
      'source-conflict',
    ]);
  });
});
