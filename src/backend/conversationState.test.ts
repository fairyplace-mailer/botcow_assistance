jest.mock('./kv', () => {
  const sharedState = {
    store: new Map<string, unknown>(),
  };

  return {
    kvGetJson: jest.fn(async (key: string) => (sharedState.store.has(key) ? sharedState.store.get(key) : null)),
    kvSetJson: jest.fn(async (key: string, value: unknown) => {
      sharedState.store.set(key, value);
    }),
    __resetStore: () => sharedState.store.clear(),
    __dumpStore: () => Array.from(sharedState.store.entries()),
  };
});

import { getConversationState, saveConversationState } from './conversationState';

const kvMock = jest.requireMock('./kv') as {
  kvGetJson: jest.Mock;
  kvSetJson: jest.Mock;
  __resetStore: () => void;
  __dumpStore: () => Array<[string, unknown]>;
};

const { __resetStore, __dumpStore, kvGetJson, kvSetJson } = kvMock;

describe('conversationState', () => {
  beforeEach(() => {
    __resetStore();
    kvGetJson.mockClear();
    kvSetJson.mockClear();
  });

  it('returns null for unknown session', async () => {
    await expect(getConversationState('chat-1')).resolves.toBeNull();
    expect(kvGetJson).toHaveBeenCalledWith('conversation-state:chat-1');
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
    expect(kvSetJson).toHaveBeenCalledWith(
      'conversation-state:chat-1',
      expect.objectContaining({
        sessionId: 'chat-1',
        conversationId: 'conv_1',
        latestResponseId: 'resp_1',
      }),
    );
    expect(__dumpStore()).toEqual([
      [
        'conversation-state:chat-1',
        expect.objectContaining({
          sessionId: 'chat-1',
          conversationId: 'conv_1',
          latestResponseId: 'resp_1',
        }),
      ],
    ]);

    const loaded = await getConversationState('chat-1');
    expect(kvGetJson).toHaveBeenLastCalledWith('conversation-state:chat-1');
    await expect(kvGetJson.mock.results.at(-1)?.value).resolves.toEqual(
      expect.objectContaining({
        sessionId: 'chat-1',
        conversationId: 'conv_1',
        latestResponseId: 'resp_1',
      }),
    );
    expect(loaded).toEqual(first);
  });

  it('updates latestResponseId without dropping saved conversationId', async () => {
    const first = await saveConversationState({
      sessionId: 'chat-2',
      conversationId: 'conv_2',
      latestResponseId: 'resp_2',
    });

    expect(kvSetJson).toHaveBeenNthCalledWith(
      1,
      'conversation-state:chat-2',
      expect.objectContaining({
        sessionId: 'chat-2',
        conversationId: 'conv_2',
        latestResponseId: 'resp_2',
      }),
    );
    expect(__dumpStore()).toEqual([
      [
        'conversation-state:chat-2',
        expect.objectContaining({
          sessionId: 'chat-2',
          conversationId: 'conv_2',
          latestResponseId: 'resp_2',
        }),
      ],
    ]);

    const second = await saveConversationState({
      sessionId: 'chat-2',
      latestResponseId: 'resp_3',
    });

    expect(kvGetJson).toHaveBeenCalledWith('conversation-state:chat-2');
    await expect(kvGetJson.mock.results.at(-1)?.value).resolves.toEqual(
      expect.objectContaining({
        sessionId: 'chat-2',
        conversationId: 'conv_2',
        latestResponseId: 'resp_2',
      }),
    );
    expect(kvSetJson).toHaveBeenNthCalledWith(
      2,
      'conversation-state:chat-2',
      expect.objectContaining({
        sessionId: 'chat-2',
        conversationId: 'conv_2',
        latestResponseId: 'resp_3',
      }),
    );
    expect(second.sessionId).toBe('chat-2');
    expect(second.conversationId).toBe('conv_2');
    expect(second.latestResponseId).toBe('resp_3');
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt >= first.updatedAt).toBe(true);
  });
});
