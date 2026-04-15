export function normalizeContentToText(content: unknown): string | null {
  if (!content) return null;

  if (typeof content === 'string') {
    const trimmed = content.trim();
    return trimmed ? trimmed : null;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        if (typeof part === 'object' && part !== null && 'text' in part) {
          return String((part as any).text ?? '');
        }
        return '';
      })
      .join('\n')
      .trim();

    return text ? text : null;
  }

  if (typeof content === 'object' && content !== null && 'text' in content) {
    const text = String((content as any).text ?? '').trim();
    return text ? text : null;
  }

  return null;
}

export function latestUserText(messages: Array<{ role: string; content: unknown }>): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== 'user') continue;
    const text = normalizeContentToText(message.content);
    if (text) return text;
  }
  return null;
}

export function allMessagesText(messages: Array<{ role: string; content: unknown }>): string {
  return messages
    .map((message) => normalizeContentToText(message?.content) ?? '')
    .filter(Boolean)
    .join('\n');
}
