export type CompactableMessage = {
  role: string;
  content: unknown;
};

export type CompactionResult = {
  messages: CompactableMessage[];
  applied: boolean;
  summary: string | null;
  originalCount: number;
  compactedCount: number;
  keptRecentCount: number;
  droppedMessageCount: number;
};

export type CompactionOptions = {
  maxMessageCount?: number;
  maxTotalChars?: number;
  keepRecentMessages?: number;
  maxSummaryChars?: number;
};

const DEFAULT_MAX_MESSAGE_COUNT = 12;
const DEFAULT_MAX_TOTAL_CHARS = 12_000;
const DEFAULT_KEEP_RECENT_MESSAGES = 8;
const DEFAULT_MAX_SUMMARY_CHARS = 4_000;
const MAX_SECTION_ITEMS = 4;
const MAX_ITEM_CHARS = 260;

const TECHNICAL_STATE_RE =
  /(branch|origin\/|working tree|commit|push|build|deploy|vercel|migration|migrate|prisma|schema|strict mode|responses api|retrieval|bootstrap|ingest|rag|tool|pass|fail|error|tsc|typescript|jest|test suite|preview|production)/i;
const OPEN_ISSUE_RE =
  /(todo|remaining|left to do|left|next step|next|problem|issue|failing|failed|error|fix|not working|does not|doesn't|blocked|needs to|need to|must)/i;

function normalizeContentToText(content: unknown): string | null {
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
      .filter(Boolean)
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

type MessageInfo = {
  index: number;
  role: string;
  text: string;
  original: CompactableMessage;
  isFixed: boolean;
};

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

function collectRoleSnippets(messages: MessageInfo[], role: string, limit: number): string[] {
  return dedupe(
    messages
      .filter((message) => message.role === role)
      .slice(-limit)
      .map((message) => truncateText(message.text.replace(/\s+/g, ' ').trim(), MAX_ITEM_CHARS)),
  ).filter(Boolean);
}

function collectPatternSnippets(messages: MessageInfo[], pattern: RegExp, limit: number): string[] {
  return dedupe(
    messages
      .filter((message) => pattern.test(message.text))
      .slice(-limit)
      .map((message) => truncateText(message.text.replace(/\s+/g, ' ').trim(), MAX_ITEM_CHARS)),
  ).filter(Boolean);
}

function formatSection(title: string, items: string[]): string[] {
  if (!items.length) return [];
  return [title, ...items.slice(0, MAX_SECTION_ITEMS).map((item) => `- ${item}`), ''];
}

function buildCompactionSummary(
  allConversationMessages: MessageInfo[],
  olderConversationMessages: MessageInfo[],
  maxSummaryChars: number,
): string | null {
  if (!olderConversationMessages.length) return null;

  const firstUserGoal =
    allConversationMessages.find((message) => message.role === 'user')?.text?.replace(/\s+/g, ' ').trim() ?? '';

  const earlierUserContext = collectRoleSnippets(olderConversationMessages, 'user', 3);
  const earlierAssistantState = collectRoleSnippets(olderConversationMessages, 'assistant', 3);
  const technicalState = collectPatternSnippets(olderConversationMessages, TECHNICAL_STATE_RE, 4);
  const openIssues = collectPatternSnippets(olderConversationMessages, OPEN_ISSUE_RE, 4);

  const lines: string[] = [
    'Conversation compaction summary',
    'Keep this as background context. Recent raw messages below have priority if they conflict.',
    '',
  ];

  if (firstUserGoal) {
    lines.push('Current task');
    lines.push(`- ${truncateText(firstUserGoal, MAX_ITEM_CHARS)}`);
    lines.push('');
  }

  lines.push(...formatSection('Earlier user context', earlierUserContext));
  lines.push(...formatSection('Earlier assistant/results', earlierAssistantState));
  lines.push(...formatSection('Repo/task/tool state', technicalState));
  lines.push(...formatSection('Open issues to preserve', openIssues));

  lines.push('Do not silently drop repo state, actionable coding context, or recent tool outcomes from this summary.');

  const summary = lines.join('\n').trim();
  return truncateText(summary, maxSummaryChars);
}

export function compactAssistantMessages(
  messages: CompactableMessage[],
  options: CompactionOptions = {},
): CompactionResult {
  const maxMessageCount = options.maxMessageCount ?? DEFAULT_MAX_MESSAGE_COUNT;
  const maxTotalChars = options.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS;
  const keepRecentMessages = options.keepRecentMessages ?? DEFAULT_KEEP_RECENT_MESSAGES;
  const maxSummaryChars = options.maxSummaryChars ?? DEFAULT_MAX_SUMMARY_CHARS;

  const infos: MessageInfo[] = (messages ?? [])
    .map((message, index) => {
      if (!message || typeof message.role !== 'string') return null;
      const text = normalizeContentToText(message.content);
      if (!text) return null;
      const role =
        message.role === 'user' || message.role === 'assistant' || message.role === 'system' || message.role === 'developer'
          ? message.role
          : 'user';
      return {
        index,
        role,
        text,
        original: message,
        isFixed: role === 'system' || role === 'developer',
      } satisfies MessageInfo;
    })
    .filter((item): item is MessageInfo => Boolean(item));

  const conversationMessages = infos.filter((message) => !message.isFixed);
  const totalChars = infos.reduce((sum, message) => sum + message.text.length, 0);
  const shouldCompact = infos.length > maxMessageCount || totalChars > maxTotalChars;

  if (!shouldCompact || conversationMessages.length <= keepRecentMessages) {
    return {
      messages,
      applied: false,
      summary: null,
      originalCount: messages.length,
      compactedCount: messages.length,
      keptRecentCount: conversationMessages.length,
      droppedMessageCount: 0,
    };
  }

  const keptConversation = conversationMessages.slice(-keepRecentMessages);
  const olderConversation = conversationMessages.slice(0, -keepRecentMessages);
  const keptIndexes = new Set(keptConversation.map((message) => message.index));
  const summary = buildCompactionSummary(conversationMessages, olderConversation, maxSummaryChars);

  if (!summary) {
    return {
      messages,
      applied: false,
      summary: null,
      originalCount: messages.length,
      compactedCount: messages.length,
      keptRecentCount: conversationMessages.length,
      droppedMessageCount: 0,
    };
  }

  const compacted: CompactableMessage[] = [];
  let summaryInserted = false;

  for (const message of infos) {
    if (message.isFixed) {
      compacted.push(message.original);
      continue;
    }

    if (!keptIndexes.has(message.index)) continue;

    if (!summaryInserted) {
      compacted.push({ role: 'developer', content: summary });
      summaryInserted = true;
    }

    compacted.push(message.original);
  }

  if (!summaryInserted) {
    compacted.unshift({ role: 'developer', content: summary });
  }

  return {
    messages: compacted,
    applied: true,
    summary,
    originalCount: messages.length,
    compactedCount: compacted.length,
    keptRecentCount: keptConversation.length,
    droppedMessageCount: olderConversation.length,
  };
}
