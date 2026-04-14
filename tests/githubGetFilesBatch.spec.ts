jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn(),
}));

const {
  __resetGithubClientForTests,
  __setGithubClientForTests,
  getFilesBatch,
} = require('../src/backend/github');

describe('getFilesBatch', () => {
  const getContent = jest.fn();

  beforeEach(() => {
    __resetGithubClientForTests();
    getContent.mockReset();
  });

  test('reads multiple files and applies truncation limits', async () => {
    __setGithubClientForTests({
      repos: {
        getContent,
      },
    });

    getContent
      .mockResolvedValueOnce({ data: { content: Buffer.from('abcdefghij').toString('base64') } })
      .mockResolvedValueOnce({ data: { content: Buffer.from('klmnopqrst').toString('base64') } });

    const result = await getFilesBatch({
      paths: ['a.ts', 'b.ts'],
      repo: 'fairyplace-mailer/botcow_assistance',
      ref: 'provecta',
      maxCharsPerFile: 4,
      maxTotalChars: 7,
    });

    expect(result.totalCharsReturned).toBe(7);
    expect(result.files).toEqual([
      expect.objectContaining({ path: 'a.ts', content: 'abcd', truncated: true, returnedChars: 4 }),
      expect.objectContaining({ path: 'b.ts', content: 'klm', truncated: true, returnedChars: 3 }),
    ]);
  });

  test('rejects an empty batch after normalization', async () => {
    await expect(
      getFilesBatch({
        paths: ['', '   '],
        repo: 'fairyplace-mailer/botcow_assistance',
        ref: 'provecta',
      }),
    ).rejects.toThrow('paths must contain at least 1 unique non-empty item');
  });

  test('rejects batches above 20 unique paths instead of silently trimming', async () => {
    await expect(
      getFilesBatch({
        paths: Array.from({ length: 21 }, (_, index) => `file-${index}.ts`),
        repo: 'fairyplace-mailer/botcow_assistance',
        ref: 'provecta',
      }),
    ).rejects.toThrow('paths must contain at most 20 unique non-empty items');
  });

  test('returns per-file errors without aborting the whole batch', async () => {
    __setGithubClientForTests({
      repos: {
        getContent,
      },
    });

    getContent
      .mockRejectedValueOnce(new Error('missing file'))
      .mockResolvedValueOnce({ data: { content: Buffer.from('ok').toString('base64') } });

    const result = await getFilesBatch({
      paths: ['missing.ts', 'ok.ts'],
      repo: 'fairyplace-mailer/botcow_assistance',
      ref: 'provecta',
    });

    expect(result.files[0]).toEqual(expect.objectContaining({ path: 'missing.ts', error: 'missing file' }));
    expect(result.files[1]).toEqual(expect.objectContaining({ path: 'ok.ts', content: 'ok' }));
  });
});
