jest.mock('./kv', () => ({
  kvGetJson: jest.fn(),
  kvSetJson: jest.fn(),
}));

import { getConversationState, saveConversationState } from './conversationState';
import { kvGetJson, kvSetJson } from './kv';

const mockedKvGetJson = kvGetJson as jest.MockedFunction<typeof kvGetJson>;
const mockedKvSetJson = kvSetJson as jest.MockedFunction<typeof kvSetJson>;

describe('conversationState', () => {
  beforeEach(() => {
    mockedKvGetJson.mockReset();
    mockedKvSetJson.mockReset();
  });

  it('returns null for unknown session', async () => {
    mockedKvGetJson.mockResolvedValueOnce(null);

    await expect(getConversationState('chat-1')).resolves.toBeNull();
    expect(mockedKvGetJson).toHaveBeenCalledWith('conversation-state:chat-1');
  });

  it('persists session to conversation/latest response linkage', async () => {
    mockedKvGetJson.mockResolvedValueOnce(null).mockResolvedValueOnce({
      sessionId: 'chat-1',
      conversationId: 'conv_1',
      latestResponseId: 'resp_1',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    });

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
    expect(mockedKvSetJson).toHaveBeenCalledWith(
      'conversation-state:chat-1',
      expect.objectContaining({
        sessionId: 'chat-1',
        conversationId: 'conv_1',
        latestResponseId: 'resp_1',
      }),
    );

    const loaded = await getConversationState('chat-1');
    expect(mockedKvGetJson).toHaveBeenLastCalledWith('conversation-state:chat-1');
    await expect(mockedKvGetJson.mock.results.at(-1)?.value).resolves.toEqual(
      expect.objectContaining({
        sessionId: 'chat-1',
        conversationId: 'conv_1',
        latestResponseId: 'resp_1',
      }),
    );
    expect(loaded).toEqual(
      expect.objectContaining({
        sessionId: 'chat-1',
        conversationId: 'conv_1',
        latestResponseId: 'resp_1',
      }),
    );
  });

  it('updates latestResponseId without dropping saved conversationId', async () => {
    mockedKvGetJson
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        sessionId: 'chat-2',
        conversationId: 'conv_2',
        latestResponseId: 'resp_2',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

    const first = await saveConversationState({
      sessionId: 'chat-2',
      conversationId: 'conv_2',
      latestResponseId: 'resp_2',
    });

    expect(mockedKvSetJson).toHaveBeenNthCalledWith(
      1,
      'conversation-state:chat-2',
      expect.objectContaining({
        sessionId: 'chat-2',
        conversationId: 'conv_2',
        latestResponseId: 'resp_2',
      }),
    );

    const second = await saveConversationState({
      sessionId: 'chat-2',
      latestResponseId: 'resp_3',
    });

    expect(mockedKvGetJson).toHaveBeenLastCalledWith('conversation-state:chat-2');
    await expect(mockedKvGetJson.mock.results.at(-1)?.value).resolves.toEqual(
      expect.objectContaining({
        sessionId: 'chat-2',
        conversationId: 'conv_2',
        latestResponseId: 'resp_2',
      }),
    );
    expect(mockedKvSetJson).toHaveBeenNthCalledWith(
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
