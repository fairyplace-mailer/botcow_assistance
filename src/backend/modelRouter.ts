export type ModelId = 'gpt-4.1' | 'gpt-4.1-mini' | 'gpt-o3-mini';

export interface ModelRoutingDecision {
  model: ModelId;
  reason: string;
}

/**
 * Простейший роутер модели по типу задачи и объёму.
 * Работает на уровне backend, до вызова runAssistant.
 */
export function chooseModel(
  messages: Array<{ role: string; content: any }>,
): ModelRoutingDecision {
  const lastUser = findLastUserMessage(messages);
  const text = normalizeContentToText(lastUser?.content);

  // Если нет текста пользователя — по умолчанию мини
  if (!text) {
    return {
      model: 'gpt-4.1-mini',
      reason: 'no-user-text',
    };
  }

  const length = text.length;

  const hasCodeFence = text.includes('```');
  const hasTsKeywords = /\b(import|export|function|class|interface|type|const)\b/.test(
    text,
  );
  const hasStackTrace =
    text.includes('Error:') ||
    text.includes('TypeError') ||
    text.includes('ReferenceError');

  const hasArchWords =
    /архитектур|architecture|design pattern|диаграмм/i.test(text);

  const hasRefactorWords =
    /рефактор|refactor|оптимизируй|оптимизация/i.test(text);

  const manyMessages = messages.length > 20;
  const longContext = length > 2000;

  // 1) Сложные задачи анализа/архитектуры, большой контекст → gpt-4.1
  if (hasArchWords || (longContext && manyMessages)) {
    return {
      model: 'gpt-4.1',
      reason: 'architecture-or-long-context',
    };
  }

  // 2) Точный reasoning / код / ошибки / стэктрейсы → gpt-o3-mini
  if (hasCodeFence || hasTsKeywords || hasStackTrace || hasRefactorWords) {
    return {
      model: 'gpt-o3-mini',
      reason: 'code-or-error-or-refactor',
    };
  }

  // 3) Обычные короткие/средние запросы → gpt-4.1-mini
  if (length < 1500 && !manyMessages) {
    return {
      model: 'gpt-4.1-mini',
      reason: 'short-or-medium-request',
    };
  }

  // 4) Остальное (длинные/сложные, но без явного кода) → gpt-4.1
  return {
    model: 'gpt-4.1',
    reason: 'fallback-long-or-complex',
  };
}

function findLastUserMessage(
  messages: Array<{ role: string; content: any }>,
): { role: string; content: any } | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      return messages[i];
    }
  }
  return undefined;
}

function normalizeContentToText(content: any): string | null {
  if (!content) return null;

  if (typeof content === 'string') {
    return content;
  }

  // Если content — массив частей (формат OpenAI), вытаскиваем текстовые
  if (Array.isArray(content)) {
    const parts = content
      .map((part) => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        if (typeof part === 'object' && 'text' in part && part.text) {
          return String((part as any).text);
        }
        return '';
      })
      .filter(Boolean);

    const joined = parts.join('\n').trim();
    return joined.length > 0 ? joined : null;
  }

  // На всякий случай
  if (typeof content === 'object' && 'text' in content) {
    const text = String((content as any).text ?? '').trim();
    return text.length > 0 ? text : null;
  }

  return null;
}
