// src/backend/modelRouter.ts

export type ModelId =
  | 'gpt-5.1'
  | 'gpt-5.1-mini'
  | 'gpt-5.1-codex-mini'
  | 'o3-mini';

export interface ModelRoutingDecision {
  model: ModelId;
  reason: string;
}

/**
 * Роутинг модели по содержимому диалога.
 * Работает на уровне backend, до вызова runAssistant.
 *
 * Идея:
 * - o3-mini: сложный reasoning, баги, ревью кода, стэктрейсы.
 * - gpt-5.1-codex-mini: генерация/мелкий рефактор кода.
 * - gpt-5.1: архитектура, большие/сложные контексты.
 * - gpt-5.1-mini: всё короткое, статусы, PM, "болтовня".
 */
export function chooseModel(
  messages: Array<{ role: string; content: unknown }>,
): ModelRoutingDecision {
  const lastUser = findLastUserMessage(messages);
  const text = normalizeContentToText(lastUser?.content);

  // Нет текста пользователя → дешёвый дефолт
  if (!text) {
    return {
      model: 'gpt-5.1-mini',
      reason: 'no-user-text',
    };
  }

  const length = text.length;
  const manyMessages = messages.length > 20;
  const longContext = length > 2000;

  const flags = detectFlags(text);

  // 1) Жёсткий reasoning по коду / багам / ревью → o3-mini
  if (
    flags.hasStackTrace ||
    flags.hasBugWords ||
    flags.hasReviewWords ||
    (flags.hasCodeFence && longContext) ||
    (flags.hasTsKeywords && longContext)
  ) {
    return {
      model: 'o3-mini',
      reason: 'deep-code-reasoning-or-bug-or-review',
    };
  }

  // 2) Архитектура, дизайн, большие задачки → gpt-5.1
  if (flags.hasArchWords || (longContext && manyMessages)) {
    return {
      model: 'gpt-5.1',
      reason: 'architecture-or-long-context',
    };
  }

  // 3) Генерация/мелкий рефактор кода → gpt-5.1-codex-mini
  if (
    flags.hasCodeFence ||
    flags.hasTsKeywords ||
    flags.hasDiff ||
    flags.hasRefactorWords
  ) {
    // Если очень большой блок кода, лучше отдать в o3-mini
    if (longContext || manyMessages) {
      return {
        model: 'o3-mini',
        reason: 'large-code-context-fallback-to-o3-mini',
      };
    }

    return {
      model: 'gpt-5.1-codex-mini',
      reason: 'code-gen-or-small-refactor',
    };
  }

  // 4) PM / статусы / деплой / Vercel → gpt-5.1-mini
  if (flags.hasPmWords && length < 2000) {
    return {
      model: 'gpt-5.1-mini',
      reason: 'pm-or-status-or-deploy',
    };
  }

  // 5) Обычные короткие/средние запросы → gpt-5.1-mini
  if (length < 1500 && !manyMessages) {
    return {
      model: 'gpt-5.1-mini',
      reason: 'short-or-medium-request',
    };
  }

  // 6) Остальное (длинные/сложные без явного кода) → gpt-5.1
  return {
    model: 'gpt-5.1',
    reason: 'fallback-long-or-complex',
  };
}

function findLastUserMessage(
  messages: Array<{ role: string; content: unknown }>,
): { role: string; content: unknown } | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      return messages[i];
    }
  }
  return undefined;
}

function normalizeContentToText(content: unknown): string | null {
  if (!content) return null;

  if (typeof content === 'string') {
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  // content — массив частей (формат OpenAI)
  if (Array.isArray(content)) {
    const parts = content
      .map((part) => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        if (typeof part === 'object' && 'text' in part && (part as any).text) {
          return String((part as any).text);
        }
        return '';
      })
      .filter(Boolean);

    const joined = parts.join('\n').trim();
    return joined.length > 0 ? joined : null;
  }

  // content — объект с полем text
  if (typeof content === 'object' && content !== null && 'text' in content) {
    const text = String((content as any).text ?? '').trim();
    return text.length > 0 ? text : null;
  }

  return null;
}

function detectFlags(text: string) {
  const lower = text.toLowerCase();

  const hasCodeFence = text.includes('```');

  const hasTsKeywords = /\b(import|export|function|class|interface|type|const|let|async|await)\b/.test(
    text,
  );

  const hasStackTrace =
    text.includes('Error:') ||
    text.includes('TypeError') ||
    text.includes('ReferenceError') ||
    text.includes('UnhandledPromiseRejection') ||
    /stack trace/i.test(text);

  const hasArchWords =
    /архитектур|architecture|design pattern|диаграмм|слой|слоями|boundary|порт-адаптер/i.test(
      text,
    );

  const hasRefactorWords =
    /рефактор|refactor|оптимизируй|оптимизация|почисти код|cleanup/i.test(text);

  const hasBugWords =
    /bug|баг|ошибк|сломалось|falling|crash|crashed|падает/i.test(text);

  const hasReviewWords =
    /review|ревью|code review|проверь код|посмотри дифф|посмотри diff/i.test(
      lower,
    );

  const hasDiff =
    /diff --git|@@ .+ @@|^\+\+\+ |^--- /m.test(text) ||
    /```diff/.test(text);

  const hasPmWords =
    /issue|ticket|task|задач[аеи]|project board|kanban|kanban board|roadmap|эпик|epic|статус|status|update status|progress/i.test(
      lower,
    ) ||
    /deploy|деплой|redeploy|rollback|roll back|верцел|vercel|лог деплоя|deployment log/i.test(
      lower,
    );

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
  };
}
