export function looksLikeRepoAuditRequest(text: string): boolean {
  if (!text) return false;

  const hasAuditPhrase =
    /\b(full audit|audit code|audit the code|audit codebase|repo audit|spec audit|read-?only audit|compliance check|check compliance|verify compliance)\b/i.test(
      text,
    ) ||
    /полный аудит|сделать аудит|аудит кода|аудит репо|проверк[ау]\s+на\s+соответствие|проверь\s+на\s+соответствие|аудит\s+по|сверь\s+с\s+strong_spec|сверить\s+с\s+strong_spec|сопоставь\s+с\s+strong_spec/i.test(
      text,
    );

  const hasSpecCheckPhrase =
    /\b(check|verify|inspect|compare)\b.{0,40}\b(docs\/strong_spec\.md|strong_spec|responses api|strict mode)\b/i.test(
      text,
    ) ||
    /\b(docs\/strong_spec\.md|strong_spec|responses api|strict mode)\b.{0,40}\b(check|verify|inspect|compare)\b/i.test(
      text,
    ) ||
    /(проверь|сверь|сопоставь|сравни).{0,40}(docs\/strong_spec\.md|strong_spec|responses api|strict mode)/i.test(
      text,
    ) ||
    /(docs\/strong_spec\.md|strong_spec|responses api|strict mode).{0,40}(проверь|сверь|сопоставь|сравни)/i.test(
      text,
    );

  const hasRepoScope =
    /docs\/strong_spec\.md|strong_spec|repo|repository|branch|ветк|репо|codebase|кодовая база/i.test(text);

  const hasReadOnlyAuditConstraint =
    /do not change|do not modify|read-only|не меняй|не изменяй|ничего не меняй/i.test(text);

  return (hasAuditPhrase && (hasRepoScope || hasReadOnlyAuditConstraint)) || hasSpecCheckPhrase;
}
