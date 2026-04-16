import type { ChatRoutingHints } from './contracts/chat';
import { looksLikeRepoAuditRequest } from './guards/repoAuditIntent';
import { hasGoldenCoreTouch } from './guards/goldenCore';
import { shouldUseReasoningByPolicy } from './guards/strongModePolicy';

export type ModelId = 'gpt-5.4' | 'gpt-5.4-mini' | 'gpt-5.4-nano';
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ModelRoutingDecision {
  model: ModelId;
  reasoning?: { effort: ReasoningEffort };
  reason: string;
  debug?: {
    textLength: number;
    messageCount: number;
    flags: Record<string, boolean>;
    scores?: Record<string, number>;
  };
}

type ModelConfig = Pick<ModelRoutingDecision, 'model' | 'reasoning'>;

export const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small' as const;

const isDebugMode = process.env.NODE_ENV !== 'production';

const MODEL_MINI_NONE: ModelConfig = {
  model: 'gpt-5.4-mini',
};

export function chooseModel(
  messages: Array<{ role: string; content: unknown }>,
  hints: ChatRoutingHints = {},
): ModelRoutingDecision {
  const lastUser = findLastUserMessage(messages);
  const lastUserText = normalizeContentToText(lastUser?.content);

  const messageCount = Array.isArray(messages) ? messages.length : 0;
  const touchedFiles = hints.touchedFiles ?? [];
  const explicitLongContextSize = hints.longContextSize ?? 0;
  const explicitMultiFileIntent = !!hints.multiFileIntent;
  const normalized = normalizeAllMessagesToText(messages);
  const repoAuditText = `${lastUserText ?? ''}\n${normalized.concatenatedText}`;

  if (hasGoldenCoreTouch(touchedFiles)) {
    return withOptionalDebug(
      {
        model: 'gpt-5.4',
        reasoning: { effort: hints.previousAttemptFailed ? 'xhigh' : 'high' },
        reason: 'golden-core-self-rewrite',
      },
      {
        textLength: lastUserText?.length ?? 0,
        messageCount,
        flags: { goldenCoreTouched: true },
        scores: {
          nanoScore: 0,
          miniScore: 0,
          fullScore: 10,
          noneScore: 0,
          lowScore: 0,
          mediumScore: 0,
          highScore: 8,
          xhighScore: hints.previousAttemptFailed ? 9 : 0,
        },
      },
    );
  }

  if (!lastUserText) {
    return withOptionalDebug(
      {
        ...MODEL_MINI_NONE,
        reason: 'no-user-text',
      },
      {
        textLength: 0,
        messageCount,
        flags: {},
        scores: {
          nanoScore: 0,
          miniScore: 1,
          fullScore: 0,
          noneScore: 1,
          lowScore: 0,
          mediumScore: 0,
          highScore: 0,
          xhighScore: 0,
        },
      },
    );
  }

  if (looksLikeRepoAuditRequest(repoAuditText)) {
    const forcedEffort: ReasoningEffort = hints.previousAttemptFailed ? 'xhigh' : 'high';

    return withOptionalDebug(
      {
        model: 'gpt-5.4',
        reasoning: { effort: forcedEffort },
        reason: 'repo-audit-or-spec-compliance',
      },
      {
        textLength: lastUserText.length,
        messageCount,
        flags: { repoAuditRequest: true },
        scores: {
          nanoScore: 0,
          miniScore: 0,
          fullScore: 10,
          noneScore: 0,
          lowScore: 0,
          mediumScore: 0,
          highScore: forcedEffort === 'high' ? 9 : 0,
          xhighScore: forcedEffort === 'xhigh' ? 10 : 0,
        },
      },
    );
  }

  const lastUserTextLength = lastUserText.length;
  const estimatedTotalTextLength = Math.max(normalized.totalTextLength, explicitLongContextSize);

  const flags = detectFlags(normalized.concatenatedText);
  const counts = countMarkers(normalized.concatenatedText);

  const signals = {
    messageCount,
    lastUserTextLength,
    estimatedTotalTextLength,
    codeBlockCount: counts.codeBlockCount,
    diffMarkersCount: counts.diffMarkersCount,
    errorMarkerCount: counts.errorMarkerCount,
    keywordFlags: flags,
    isLikelyClassificationTask: isLikelyClassificationTask(flags, normalized.concatenatedText),
    isLikelyArchitectureTask: isLikelyArchitectureTask(flags, hints),
    isLikelyDebugTask: isLikelyDebugTask(flags, counts),
    isLikelyCodegenTask: isLikelyCodegenTask(flags),
  };

  const scores = scoreRouting(signals, hints);

  let chosenModel: ModelId = pickModelByScore(scores);
  let chosenEffort: ReasoningEffort = pickEffortByScore(scores);
  let reason = 'score-based-routing';

  if (signals.isLikelyClassificationTask) {
    chosenModel = 'gpt-5.4-nano';
    chosenEffort = scores.lowScore > scores.noneScore ? 'low' : 'none';
    reason = 'classification-or-extraction-or-ranking';
  }

  if (hints.hasSourceConflict) {
    chosenModel = 'gpt-5.4';
    chosenEffort = 'high';
    reason = 'source-conflict';
  }

  if (signals.isLikelyDebugTask) {
    chosenModel = 'gpt-5.4';
    chosenEffort =
      scores.xhighScore > 0 ||
      (counts.errorMarkerCount >= 6 && estimatedTotalTextLength > 2500) ||
      (counts.diffMarkersCount >= 4 && estimatedTotalTextLength > 2500)
        ? 'xhigh'
        : 'high';
    reason = 'deep-code-debug-review';
  }

  if (signals.isLikelyArchitectureTask && !signals.isLikelyDebugTask) {
    chosenModel = 'gpt-5.4';
    chosenEffort = 'high';
    reason = 'architecture-or-design';
  }

  if (
    (flags.hasPmWords || flags.hasRepoOpsWords || flags.hasVercelWords || flags.hasCICDWords) &&
    !signals.isLikelyDebugTask
  ) {
    chosenModel = 'gpt-5.4-mini';

    const isDeployOrLogs =
      flags.hasVercelWords ||
      flags.hasCICDWords ||
      flags.hasStackTrace ||
      flags.hasLargeErrorPayload ||
      /deployment\s+log|build\s+failed|workflow\b|github\s+actions|ci\b/i.test(
        normalized.concatenatedText,
      );

    if (isDeployOrLogs) {
      chosenEffort = estimatedTotalTextLength < 6000 ? 'medium' : 'high';
    } else {
      if (estimatedTotalTextLength < 1200) chosenEffort = 'low';
      else if (estimatedTotalTextLength < 6000) chosenEffort = 'medium';
      else chosenEffort = 'high';
    }

    reason = 'pm-or-status-or-ci-cd-or-deploy';
  }

  if (
    signals.isLikelyCodegenTask &&
    !signals.isLikelyDebugTask &&
    !signals.isLikelyArchitectureTask &&
    !signals.isLikelyClassificationTask
  ) {
    const longOrComplex =
      estimatedTotalTextLength > 2500 ||
      messageCount > 25 ||
      counts.codeBlockCount >= 3 ||
      flags.hasMultiFileIntent ||
      explicitMultiFileIntent ||
      !!hints.toolHeavy ||
      explicitLongContextSize > 7000;

    if (longOrComplex) {
      chosenModel = 'gpt-5.4';
      chosenEffort = 'high';
      reason = 'codegen-or-refactor-long-or-complex';
    } else {
      chosenModel = 'gpt-5.4-mini';
      chosenEffort = scores.mediumScore >= scores.lowScore ? 'medium' : 'low';
      reason = 'codegen-or-refactor';
    }
  }

  if (
    !signals.isLikelyDebugTask &&
    !signals.isLikelyArchitectureTask &&
    !signals.isLikelyClassificationTask &&
    !signals.isLikelyCodegenTask &&
    !(flags.hasPmWords || flags.hasRepoOpsWords || flags.hasVercelWords || flags.hasCICDWords) &&
    !explicitMultiFileIntent &&
    lastUserTextLength < 600 &&
    messageCount < 10
  ) {
    chosenModel = 'gpt-5.4-mini';
    chosenEffort = 'low';
    reason = 'short-general-request';
  }

  if (
    !signals.isLikelyDebugTask &&
    !signals.isLikelyArchitectureTask &&
    !signals.isLikelyClassificationTask &&
    !signals.isLikelyCodegenTask &&
    (estimatedTotalTextLength > 7000 || messageCount > 30)
  ) {
    chosenModel = 'gpt-5.4';
    chosenEffort = estimatedTotalTextLength > 12000 ? 'high' : 'medium';
    reason = 'long-context-general';
  }

  if (reason === 'score-based-routing') {
    reason = chosenModel === 'gpt-5.4' ? 'fallback-high-risk' : 'fallback-not-risky';
  }

  const nanoDisallowedBySpec =
    flags.hasStackTrace ||
    flags.hasDiff ||
    flags.hasReviewWords ||
    flags.hasArchWords ||
    flags.hasBugWords ||
    ((flags.hasMultiFileIntent || explicitMultiFileIntent) &&
      (flags.hasRefactorWords ||
        flags.hasBugWords ||
        flags.hasReviewWords ||
        flags.hasDiff ||
        flags.hasStackTrace ||
        !!hints.toolHeavy ||
        touchedFiles.length > 1));

  if (chosenModel === 'gpt-5.4-nano' && nanoDisallowedBySpec) {
    const forceFullModel =
      flags.hasStackTrace ||
      flags.hasDiff ||
      flags.hasReviewWords ||
      flags.hasArchWords ||
      flags.hasBugWords ||
      ((flags.hasMultiFileIntent || explicitMultiFileIntent) &&
        (flags.hasRefactorWords || !!hints.toolHeavy || touchedFiles.length > 1));

    chosenModel = forceFullModel ? 'gpt-5.4' : 'gpt-5.4-mini';
    chosenEffort = forceFullModel ? 'high' : chosenEffort === 'none' ? 'low' : chosenEffort;
    reason = 'hard-override-nano-not-allowed-for-risk';
  }

  if (chosenEffort === 'xhigh') {
    chosenModel = 'gpt-5.4';
  }

  chosenEffort = clampEffortForModel(chosenModel, chosenEffort);

  if (!shouldUseReasoningByPolicy(reason)) {
    chosenEffort = 'none';
  }

  const decision: ModelRoutingDecision = {
    model: chosenModel,
    ...(chosenEffort !== 'none' ? { reasoning: { effort: chosenEffort } } : {}),
    reason,
  };

  const debugBase = {
    textLength: lastUserTextLength,
    messageCount,
    flags,
  };

  return withOptionalDebug(
    decision,
    isDebugMode
      ? {
          ...debugBase,
          scores: {
            nanoScore: scores.nanoScore,
            miniScore: scores.miniScore,
            fullScore: scores.fullScore,
            noneScore: scores.noneScore,
            lowScore: scores.lowScore,
            mediumScore: scores.mediumScore,
            highScore: scores.highScore,
            xhighScore: scores.xhighScore,
          },
        }
      : debugBase,
  );
}

function withOptionalDebug(
  decision: ModelRoutingDecision,
  debug: NonNullable<ModelRoutingDecision['debug']>,
): ModelRoutingDecision {
  if (!isDebugMode) {
    const { debug: _omit, ...rest } = decision;
    return rest;
  }
  return { ...decision, debug };
}

function clampEffortForModel(model: ModelId, effort: ReasoningEffort): ReasoningEffort {
  if (model === 'gpt-5.4-nano') {
    return effort === 'none' || effort === 'low' ? effort : 'low';
  }

  if (model === 'gpt-5.4-mini') {
    if (effort === 'xhigh') return 'high';
    return effort;
  }

  return effort;
}

function pickModelByScore(scores: RoutingScores): ModelId {
  if (scores.fullScore >= scores.miniScore && scores.fullScore >= scores.nanoScore) return 'gpt-5.4';
  if (scores.nanoScore > scores.miniScore) return 'gpt-5.4-nano';
  return 'gpt-5.4-mini';
}

function pickEffortByScore(scores: RoutingScores): ReasoningEffort {
  const ordered: Array<[ReasoningEffort, number]> = [
    ['xhigh', scores.xhighScore],
    ['high', scores.highScore],
    ['medium', scores.mediumScore],
    ['low', scores.lowScore],
    ['none', scores.noneScore],
  ];

  return ordered.reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0];
}

type KeywordFlags = ReturnType<typeof detectFlags>;

type Signals = {
  messageCount: number;
  lastUserTextLength: number;
  estimatedTotalTextLength: number;
  codeBlockCount: number;
  diffMarkersCount: number;
  errorMarkerCount: number;
  keywordFlags: KeywordFlags;
  isLikelyClassificationTask: boolean;
  isLikelyArchitectureTask: boolean;
  isLikelyDebugTask: boolean;
  isLikelyCodegenTask: boolean;
};

type RoutingScores = {
  nanoScore: number;
  miniScore: number;
  fullScore: number;
  noneScore: number;
  lowScore: number;
  mediumScore: number;
  highScore: number;
  xhighScore: number;
};

function scoreRouting(s: Signals, hints: ChatRoutingHints): RoutingScores {
  const { keywordFlags: f } = s;

  const nanoScore =
    8 * bool(s.isLikelyClassificationTask) +
    2 * bool(f.hasExtractionWords) +
    2 * bool(f.hasClassificationWords) +
    2 * bool(f.hasRankingWords) +
    2 * bool(f.hasJsonSchemaWords) -
    8 * bool(s.isLikelyDebugTask) -
    6 * bool(s.isLikelyArchitectureTask) -
    4 * bool(s.isLikelyCodegenTask) -
    3 * bool(f.hasCodeFence);

  const fullScore =
    8 * bool(s.isLikelyDebugTask) +
    7 * bool(s.isLikelyArchitectureTask) +
    4 * bool(!!hints.previousAttemptFailed) +
    4 * bool(!!hints.hasSourceConflict) +
    3 * bool(f.hasSecurityWords) +
    3 * bool(f.hasLargeErrorPayload) +
    3 * bool(f.hasMultiFileIntent) +
    3 * bool(!!hints.multiFileIntent) +
    2 * bool(!!hints.toolHeavy) +
    (s.estimatedTotalTextLength > 8000 ? 3 : 0) +
    (s.messageCount > 25 ? 2 : 0) +
    (s.diffMarkersCount >= 2 ? 2 : 0) +
    (s.errorMarkerCount >= 3 ? 2 : 0) +
    (s.codeBlockCount >= 2 ? 1 : 0);

  const miniScore =
    3 +
    4 * bool(s.isLikelyCodegenTask) +
    3 * bool(f.hasPmWords || f.hasRepoOpsWords || f.hasVercelWords || f.hasCICDWords) +
    2 * bool((hints.ragSourceCount ?? 0) >= 2) +
    1 * bool(f.hasUiFrontendWords) +
    (s.lastUserTextLength < 800 ? 1 : 0) -
    2 * bool(s.isLikelyArchitectureTask) -
    2 * bool(s.isLikelyDebugTask);

  const noneScore =
    4 * bool(s.isLikelyClassificationTask) +
    2 * bool(s.lastUserTextLength < 300) +
    1 * bool(s.messageCount < 8) -
    3 * bool(s.isLikelyDebugTask) -
    2 * bool(s.isLikelyArchitectureTask) -
    1 * bool(s.isLikelyCodegenTask);

  const lowScore =
    2 * bool(s.isLikelyClassificationTask) +
    3 * bool(s.isLikelyCodegenTask) +
    2 * bool(f.hasPmWords || f.hasRepoOpsWords || f.hasVercelWords || f.hasCICDWords) +
    2 * bool(s.lastUserTextLength >= 300 && s.lastUserTextLength < 1200) -
    1 * bool(s.isLikelyDebugTask);

  const mediumScore =
    4 * bool(s.isLikelyCodegenTask) +
    3 * bool(f.hasTestWords) +
    2 * bool(f.hasMigrationWords) +
    2 * bool(f.hasUiFrontendWords) +
    2 * bool((hints.ragSourceCount ?? 0) >= 2) +
    (s.messageCount > 10 ? 1 : 0) +
    (s.estimatedTotalTextLength > 3000 ? 1 : 0) -
    2 * bool(s.isLikelyClassificationTask);

  const highScore =
    6 * bool(s.isLikelyDebugTask) +
    5 * bool(s.isLikelyArchitectureTask) +
    4 * bool(!!hints.hasSourceConflict) +
    2 * bool(s.estimatedTotalTextLength > 6000) +
    2 * bool(f.hasMultiFileIntent) +
    2 * bool(!!hints.multiFileIntent) +
    2 * bool(f.hasReviewWords) +
    2 * bool(f.hasDiff) -
    4 * bool(s.isLikelyClassificationTask);

  const xhighScore =
    7 * bool(s.isLikelyDebugTask && f.hasLargeErrorPayload) +
    5 * bool(!!hints.previousAttemptFailed) +
    3 * bool(s.diffMarkersCount >= 4) +
    3 * bool(s.errorMarkerCount >= 6) +
    2 * bool(s.estimatedTotalTextLength > 12000);

  return {
    nanoScore,
    miniScore,
    fullScore,
    noneScore,
    lowScore,
    mediumScore,
    highScore,
    xhighScore,
  };
}

function bool(x: boolean): number {
  return x ? 1 : 0;
}

function findLastUserMessage(
  messages: Array<{ role: string; content: unknown }>,
): { role: string; content: unknown } | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') return messages[i];
  }
  return undefined;
}

type NormalizedMessages = {
  concatenatedText: string;
  totalTextLength: number;
};

function normalizeAllMessagesToText(
  messages: Array<{ role: string; content: unknown }>,
): NormalizedMessages {
  const parts: string[] = [];
  let totalTextLength = 0;

  for (const message of messages ?? []) {
    const text = normalizeContentToText(message?.content);
    if (text) {
      parts.push(text);
      totalTextLength += text.length;
    }
  }

  return {
    concatenatedText: parts.join('\n\n'),
    totalTextLength,
  };
}

function normalizeContentToText(content: unknown): string | null {
  if (!content) return null;

  if (typeof content === 'string') {
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (Array.isArray(content)) {
    const parts = content
      .map((part) => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        if (typeof part === 'object' && part !== null && 'text' in part && (part as any).text) {
          return String((part as any).text);
        }
        return '';
      })
      .filter(Boolean);

    const joined = parts.join('\n').trim();
    return joined.length > 0 ? joined : null;
  }

  if (typeof content === 'object' && content !== null && 'text' in content) {
    const text = String((content as any).text ?? '').trim();
    return text.length > 0 ? text : null;
  }

  return null;
}

function countMarkers(text: string): {
  codeBlockCount: number;
  diffMarkersCount: number;
  errorMarkerCount: number;
} {
  const codeBlockCount = (text.match(/```/g)?.length ?? 0) / 2;
  const diffMarkersCount =
    (text.match(/diff --git/g)?.length ?? 0) +
    (text.match(/\n@@/g)?.length ?? 0) +
    (text.match(/```diff/g)?.length ?? 0);

  const errorMarkerCount =
    (text.match(/\bError\b/g)?.length ?? 0) +
    (text.match(/\bTypeError\b/g)?.length ?? 0) +
    (text.match(/\bReferenceError\b/g)?.length ?? 0) +
    (text.match(/\bUnhandledPromiseRejection\b/g)?.length ?? 0) +
    (text.match(/\bException\b/g)?.length ?? 0) +
    (text.match(/stack trace/gi)?.length ?? 0) +
    (text.match(/traceback/gi)?.length ?? 0);

  return {
    codeBlockCount: Math.floor(codeBlockCount),
    diffMarkersCount,
    errorMarkerCount,
  };
}

function isLikelyClassificationTask(flags: KeywordFlags, text: string): boolean {
  if (
    flags.hasClassificationWords ||
    flags.hasExtractionWords ||
    flags.hasRankingWords ||
    flags.hasJsonSchemaWords
  ) {
    return true;
  }

  const lower = text.toLowerCase();
  return /output\s+only\s+json|верни\s+json|только\s+json|json\s+without\s+explanation/.test(lower);
}

function isLikelyArchitectureTask(flags: KeywordFlags, hints: ChatRoutingHints): boolean {
  return !!(
    flags.hasArchWords ||
    flags.hasSecurityWords ||
    flags.hasMultiFileIntent ||
    hints.multiFileIntent ||
    hints.hasSourceConflict
  );
}

function isLikelyDebugTask(
  flags: KeywordFlags,
  counts: { diffMarkersCount: number; errorMarkerCount: number },
): boolean {
  return !!(
    flags.hasStackTrace ||
    flags.hasBugWords ||
    flags.hasReviewWords ||
    flags.hasDiff ||
    counts.errorMarkerCount >= 2 ||
    counts.diffMarkersCount >= 2 ||
    flags.hasLargeErrorPayload
  );
}

function isLikelyCodegenTask(flags: KeywordFlags): boolean {
  return !!(
    flags.hasCodeFence ||
    flags.hasTsKeywords ||
    flags.hasRefactorWords ||
    flags.hasDiff ||
    flags.hasTestWords ||
    flags.hasUiFrontendWords
  );
}

function detectFlags(text: string) {
  const lower = text.toLowerCase();

  const hasCodeFence = text.includes('```');
  const hasTsKeywords = /\b(import|export|function|class|interface|type|const|let|async|await)\b/.test(text);
  const hasStackTrace =
    text.includes('Error:') ||
    text.includes('TypeError') ||
    text.includes('ReferenceError') ||
    text.includes('UnhandledPromiseRejection') ||
    /stack trace/i.test(text) ||
    /traceback/i.test(text);

  const hasArchWords =
    /архитектур|architecture|design pattern|диаграмм|слой|слоями|boundary|port\s*-\s*adapter|trade-?off|hexagonal|ddd|domain-driven/i.test(
      lower,
    );

  const hasRefactorWords =
    /рефактор|refactor|оптимизируй|оптимизация|почисти код|cleanup|rename|extract\s+method/i.test(lower);

  const hasBugWords =
    /bug|баг|ошибк|сломалось|crash|crashed|падает|regression|incident|panic/i.test(lower);

  const hasReviewWords =
    /review|ревью|code\s*review|проверь\s+код|посмотри\s+дифф|посмотри\s+diff|nit:|nitpick/i.test(lower);

  const hasDiff = /diff --git|@@ .+ @@|^\+\+\+ |^--- /m.test(text) || /```diff/.test(text);

  const hasPmWords =
    /issue|ticket|task|задач[аеии]|project\s+board|kanban|roadmap|эпик|epic|статус|status|update\s+status|progress|milestone/i.test(
      lower,
    );

  const hasVercelWords = /\bvercel\b|верцел|deployment\s+log|лог\s+деплоя/i.test(lower);
  const hasCICDWords = /\bci\b|cicd|workflow|github\s+actions|pipeline|build\s+failed|test\s+failed/i.test(lower);
  const hasRepoOpsWords =
    /merge\s+pr|pull\s+request|branch|rebase|squash|changelog|release|tag|version\s+bump|npm\s+publish/i.test(
      lower,
    );

  const hasExtractionWords =
    /extract|extraction|извлеки|вытащи\s+поля|fields|entities|entity|normalize|parse|распарс/i.test(lower);

  const hasClassificationWords =
    /classify|classification|категориз|label|intent|определи\s+intent|маршрутиз|route\s+this/i.test(lower);

  const hasRankingWords =
    /rank|ranking|prioritiz|prioritize|sort\s+by\s+relevance|сравни\s+и\s+ранжируй|приоритиз/i.test(lower);

  const hasJsonSchemaWords =
    /json\s*schema|schema\s*:\s*\{|верни\s+json|return\s+json|output\s+json|strict\s+json/i.test(lower);

  const hasTestWords = /test|tests|unit\s*test|jest|vitest|coverage|spec\b|tdd/i.test(lower);

  const hasSecurityWords =
    /vulnerability|vulnerable|auth|authentication|authorization|token\s+leak|ssrf|csrf|xss|permission\s+denied|privilege|security/i.test(
      lower,
    );

  const hasMigrationWords =
    /migration|migrate|prisma\s+migrate|schema\.prisma|sql\s+migration|db\s+migration|database\s+change/i.test(lower);

  const hasLargeErrorPayload =
    /\n\s*at\s+.+\(.+\)/.test(text) ||
    (lower.includes('traceback') && text.length > 1500) ||
    (hasStackTrace && text.length > 1500);

  const hasMultiFileIntent =
    /по\s+всему\s+репо|по\s+всему\s+проекту|в\s+нескольких\s+файлах|across\s+the\s+repo|across\s+the\s+project|multi-?file|several\s+files|whole\s+codebase/i.test(
      lower,
    );

  const hasUiFrontendWords =
    /react|next\.js|nextjs|frontend|ui\b|ux\b|css|tailwind|component|tsx\b|hydration|layout/i.test(lower);

  return {
    hasCodeFence,
    hasTsKeywords,
    hasStackTrace,
    hasArchWords,
    hasRefactorWords,
    hasBugWords,
    hasReviewWords,
    hasDiff,
    hasPmWords,
    hasExtractionWords,
    hasClassificationWords,
    hasRankingWords,
    hasJsonSchemaWords,
    hasTestWords,
    hasSecurityWords,
    hasMigrationWords,
    hasLargeErrorPayload,
    hasMultiFileIntent,
    hasUiFrontendWords,
    hasRepoOpsWords,
    hasVercelWords,
    hasCICDWords,
  };
}
