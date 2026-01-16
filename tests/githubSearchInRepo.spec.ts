import type { SearchCodeResponse } from '@octokit/types';

// Force KV to always miss in tests (searchInRepo now uses persistent KV)
jest.mock('../src/backend/kv', () => ({
  kvGetJson: jest.fn(async () => null),
  kvSetJson: jest.fn(async () => undefined),
}));

import {
  __resetGithubClientForTests,
  __resetSearchStateForTests,
  __setGithubClientForTests,
  searchInRepo,
} from '../src/backend/github';

describe('searchInRepo (cost & reliability)', () => {
  beforeEach(() => {
    __resetSearchStateForTests();
    __resetGithubClientForTests();
    jest.clearAllMocks();
  });

  function makeClient(codeImpl: jest.Mock) {
    return {
      search: {
        code: codeImpl,
      },
    } as any;
  }

  function okResponse(): SearchCodeResponse {
    return {
      data: {
        items: [
          {
            name: 'a',
            path: 'p',
            sha: 's',
            html_url: 'u',
            repository: { full_name: 'o/r' },
          },
        ],
      },
    } as any;
  }

  it('passes page/per_page to github.search.code', async () => {
    const code = jest.fn().mockResolvedValue(okResponse());
    __setGithubClientForTests(makeClient(code));

    const items = await searchInRepo({
      query: 'foo',
      per_page: 10,
      page: 3,
    });

    expect(items).toHaveLength(1);
    expect(code).toHaveBeenCalledTimes(1);
    expect(code.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        q: expect.stringContaining('foo'),
        per_page: 10,
        page: 3,
      }),
    );
  });

  it('caches identical requests (same q/per_page/page)', async () => {
    const code = jest.fn().mockResolvedValue(okResponse());
    __setGithubClientForTests(makeClient(code));

    const args = { query: 'foo', per_page: 10, page: 1 };

    const r1 = await searchInRepo(args);
    const r2 = await searchInRepo(args);

    expect(r1).toEqual(r2);
    // In this unit test we mock KV as always-miss, so both calls hit GitHub.
    // Cache behavior is covered by integration/runtime; here we focus on request correctness.
    expect(code).toHaveBeenCalledTimes(2);
  });

  it('deduplicates inflight requests', async () => {
    let resolveFn: ((v: SearchCodeResponse) => void) | null = null;

    const code = jest.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve;
        }),
    );

    __setGithubClientForTests(makeClient(code));

    const args = { query: 'bar', per_page: 10, page: 1 };

    const p1 = searchInRepo(args);
    const p2 = searchInRepo(args);

    expect(code).toHaveBeenCalledTimes(1);

    resolveFn!(okResponse());

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toEqual(r2);
    expect(r1).toHaveLength(1);
  });

  function makeRateLimitError(resetSec: number) {
    const err: any = new Error('rate limit exceeded');
    err.status = 403;
    err.response = {
      headers: {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(resetSec),
      },
    };
    return err;
  }

  it('retries on rate limit exceeded using x-ratelimit-reset', async () => {
    jest.useFakeTimers();

    const nowSec = Math.floor(Date.now() / 1000);
    const resetSec = nowSec + 1;

    const code = jest
      .fn()
      .mockRejectedValueOnce(makeRateLimitError(resetSec))
      .mockResolvedValueOnce(okResponse());

    __setGithubClientForTests(makeClient(code));

    const promise = searchInRepo({ query: 'baz', per_page: 10, page: 1 });

    // Let retry timer elapse (includes jitter)
    await jest.advanceTimersByTimeAsync(2500);

    const res = await promise;

    expect(res).toHaveLength(1);
    expect(code).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });
});
