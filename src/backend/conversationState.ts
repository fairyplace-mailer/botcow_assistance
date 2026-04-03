import { kvGetJson, kvSetJson } from './kv';

const KEY_PREFIX = 'conversation-state:';

export type ConversationStateRecord = {
  sessionId: string;
  conversationId: string | null;
  latestResponseId: string | null;
  createdAt: string;
  updatedAt: string;
};

function makeKey(sessionId: string): string {
  return `${KEY_PREFIX}${sessionId}`;
}

export async function getConversationState(
  sessionId: string,
): Promise<ConversationStateRecord | null> {
  return kvGetJson<ConversationStateRecord>(makeKey(sessionId));
}

export async function saveConversationState(params: {
  sessionId: string;
  conversationId?: string | null;
  latestResponseId?: string | null;
}): Promise<ConversationStateRecord> {
  const now = new Date().toISOString();
  const existing = await getConversationState(params.sessionId);

  const next: ConversationStateRecord = {
    sessionId: params.sessionId,
    conversationId:
      params.conversationId !== undefined
        ? params.conversationId
        : existing?.conversationId ?? null,
    latestResponseId:
      params.latestResponseId !== undefined
        ? params.latestResponseId
        : existing?.latestResponseId ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await kvSetJson(makeKey(params.sessionId), next);
  return next;
}
