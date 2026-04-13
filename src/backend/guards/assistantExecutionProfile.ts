export type AssistantExecutionProfile = {
  mode: 'default' | 'repo_audit';
  instructions: string;
  maxToolLoops: number;
  maxTotalToolCalls: number;
  maxSameFingerprintInRow: number;
  toolTimeoutMs: number;
};

const DEFAULT_MAX_TOOL_LOOPS = 12;
const DEFAULT_MAX_TOTAL_TOOL_CALLS = 24;
const DEFAULT_MAX_SAME_FINGERPRINT_IN_ROW = 2;
const DEFAULT_TOOL_TIMEOUT_MS = 20_000;

const AUDIT_MAX_TOOL_LOOPS = 40;
const AUDIT_MAX_TOTAL_TOOL_CALLS = 160;
const AUDIT_MAX_SAME_FINGERPRINT_IN_ROW = 4;
const AUDIT_TOOL_TIMEOUT_MS = 60_000;

function looksLikeRepoAuditRequest(text: string): boolean {
  if (!text) return false;

  const hasAuditIntent =
    /\b(full audit|audit code|audit the code|audit codebase|repo audit|spec audit|strict mode|responses api)\b/i.test(
      text,
    ) || /полный аудит|сделать аудит|аудит кода|соответствие|строгий режим|репо|ветк|strong_spec/i.test(text);

  const hasRepoScope =
    /docs\/strong_spec\.md|strong_spec|repo|repository|branch|ветк|репо|strict mode|responses api/i.test(text);

  return hasAuditIntent && hasRepoScope;
}

export function buildExecutionProfile(params: {
  baseInstructions: string;
  detectionText: string;
}): AssistantExecutionProfile {
  if (!looksLikeRepoAuditRequest(params.detectionText)) {
    return {
      mode: 'default',
      instructions: params.baseInstructions,
      maxToolLoops: DEFAULT_MAX_TOOL_LOOPS,
      maxTotalToolCalls: DEFAULT_MAX_TOTAL_TOOL_CALLS,
      maxSameFingerprintInRow: DEFAULT_MAX_SAME_FINGERPRINT_IN_ROW,
      toolTimeoutMs: DEFAULT_TOOL_TIMEOUT_MS,
    };
  }

  const auditSuffix = `
Repository audit mode:
- This is a repo-wide read-only audit task.
- Do not modify files, do not commit, do not deploy.
- First read docs/strong_spec.md before judging compliance.
- Treat docs/strong_spec.md as the primary spec.
- If golden core files are present, treat golden core as higher priority than legacy docs.
- Ignore removed legacy paths such as docs/spec.md.
- Prefer broad repo inspection before conclusions.
- Prefer reading files in batches with github_get_files_batch when available.
- For repo audit, avoid one-file-per-round exploration when a batch read is possible.
- Inspect strongest candidate files first, then stop tool use once evidence is sufficient.
- Do not spend tool loops on exhaustive repo traversal if the main compliance answer is already supported.
- Avoid reopening the same files unless new evidence requires it.
- Before any strict-mode conclusion, inspect the Responses runtime and strict tool schema builder directly.
- Focus on exact compliance against docs/strong_spec.md.
- In the final answer, report only mismatches, partial mismatches, and whether Responses API strict mode is configured.
- Keep the answer short, direct, and in simple language.
`.trim();

  return {
    mode: 'repo_audit',
    instructions: `${params.baseInstructions}\n\n${auditSuffix}`,
    maxToolLoops: AUDIT_MAX_TOOL_LOOPS,
    maxTotalToolCalls: AUDIT_MAX_TOTAL_TOOL_CALLS,
    maxSameFingerprintInRow: AUDIT_MAX_SAME_FINGERPRINT_IN_ROW,
    toolTimeoutMs: AUDIT_TOOL_TIMEOUT_MS,
  };
}
