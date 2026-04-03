jest.mock('./kv', () => {
  const store = new Map<string, unknown>();

  return {
    kvGetJson: jest.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    kvSetJson: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    __resetStore: () => store.clear(),
  };
});

import { getConversationState, saveConversationState } from './conversationState';

const { __resetStore } = jest.requireMock('./kv') as { __resetStore: () => void };

describe('conversationState', () => {
  beforeEach(() => {
    __resetStore();
  });

  it('returns null for unknown session', async () => {
    await expect(getConversationState('chat-1')).resolves.toBeNull();
  });

  it('persists session to conversation/latest response linkage', async () => {
    const first = await saveConversationState({
      sessionId: 'chat-1',
      conversationId: 'conv_1',
      latestResponseId: 'resp_1',
    });

    expect(first.sessionId).toBe('chat-1');
    expect(first.conversationId).toBe('conv_1');
    expect(first.latestResponseId).toBe('resp_1');
    expect(first.createdAt).toBeTruthy();
    expect(first.updatedAt).toBeTruthy();

    const loaded = await getConversationState('chat-1');
    expect(loaded).toEqual(first);
  });

  it('updates latestResponseId without dropping saved conversationId', async () => {
    const first = await saveConversationState({
      sessionId: 'chat-2',
      conversationId: 'conv_2',
      latestResponseId: 'resp_2',
    });

    const second = await saveConversationState({
      sessionId: 'chat-2',
      latestResponseId: 'resp_3',
    });

    expect(second.sessionId).toBe('chat-2');
    expect(second.conversationId).toBe('conv_2');
    expect(second.latestResponseId).toBe('resp_3');
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt >= first.updatedAt).toBe(true);
  });
});
