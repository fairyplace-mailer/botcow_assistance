import { compactAssistantMessages } from '../src/backend/compaction';

describe('assistant compaction policy', () => {
  it('keeps short conversations unchanged', () => {
    const result = compactAssistantMessages([
      { role: 'user', content: 'Need help with build' },
      { role: 'assistant', content: 'Send the error' },
      { role: 'user', content: 'Build failed in Next.js' },
    ]);

    expect(result.applied).toBe(false);
    expect(result.messages).toHaveLength(3);
  });

  it('builds summary that preserves task, repo/tool state, and open issues', () => {
    const messages = [
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'Bring the repo into strong_spec compliance.' },
      { role: 'assistant', content: 'We will fix bootstrap, retrieval, and strict mode.' },
      { role: 'user', content: 'Branch provecta is ahead of origin by one commit.' },
      { role: 'assistant', content: 'Jest PASS, but Next.js build failed in assistant.ts with string | null.' },
      { role: 'user', content: 'Open issue: compaction policy is still missing.' },
      { role: 'assistant', content: 'Next step: add compaction and keep recent tool outcomes.' },
      { role: 'user', content: 'Recent raw message 1' },
      { role: 'assistant', content: 'Recent raw message 2' },
      { role: 'user', content: 'Recent raw message 3' },
      { role: 'assistant', content: 'Recent raw message 4' },
      { role: 'user', content: 'Recent raw message 5' },
    ];

    const result = compactAssistantMessages(messages, { maxMessageCount: 8, keepRecentMessages: 4 });

    expect(result.applied).toBe(true);
    expect(result.summary).toContain('Conversation compaction summary');
    expect(result.summary).toContain('Bring the repo into strong_spec compliance.');
    expect(result.summary).toContain('Branch provecta is ahead of origin by one commit.');
    expect(result.summary).toContain('Jest PASS, but Next.js build failed');
    expect(result.summary).toContain('Open issue: compaction policy is still missing.');
    expect(result.messages.some((message) => message.role === 'developer')).toBe(true);
    expect(result.messages[result.messages.length - 1]).toEqual({ role: 'user', content: 'Recent raw message 5' });
  });
});
