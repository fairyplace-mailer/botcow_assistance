export const STRONG_MODE_REASON_REASONS = new Set([
  'golden-core-self-rewrite',
  'repo-audit-or-spec-compliance',
  'source-conflict',
  'deep-code-debug-review',
  'architecture-or-design',
]);

export function shouldUseReasoningByPolicy(reason: string): boolean {
  return STRONG_MODE_REASON_REASONS.has(reason);
}
