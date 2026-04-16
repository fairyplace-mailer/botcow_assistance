export const STRONG_MODE_REASON_REASONS = new Set([
  'classification-or-extraction-or-ranking',
  'pm-or-status-or-ci-cd-or-deploy',
  'codegen-or-refactor',
  'codegen-or-refactor-long-or-complex',
  'long-context-general',
  'fallback-high-risk',
  'hard-override-nano-not-allowed-for-risk',
  'golden-core-self-rewrite',
  'repo-audit-or-spec-compliance',
  'source-conflict',
  'deep-code-debug-review',
  'architecture-or-design',
]);

const REASONING_DISABLED_REASONS = new Set([
  'no-user-text',
  'short-general-request',
  'fallback-not-risky',
]);

export function shouldUseReasoningByPolicy(reason: string): boolean {
  if (REASONING_DISABLED_REASONS.has(reason)) return false;
  return STRONG_MODE_REASON_REASONS.has(reason);
}
