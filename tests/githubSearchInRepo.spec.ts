import type { SearchCodeResponse } from '@octokit/types';

// IMPORTANT:
// - Do NOT mock the whole github module (we want to test the real searchInRepo logic: cache/dedup/retry)
// - We override only the exported `github` client (which is a Proxy in runtime) with a simple mock object.
//   This keeps Next.js build-safe lazy init in src/backend/github.ts while allowing deterministic unit tests.
jest.mock('../src/backend/github', () => {
  const actual = jest.requireActual('../src/backend/github');

  const mockGithub = {
    search: {
      code: jest.fn(),
    },
  };

  return {
    ...actual,
    github: mockGithub,
  };
});

import { __resetSearchStateForTests, github, searchInRepo } from '../src/backend/github';

describe('searchInRepo', () => {
  beforeEach(() => {
    __resetSearchStateForTests();
    jest.clearAllMocks();
  });

  it('passes page to github.search.code', async () => {
    const spy = (github as unknown as { search: { code: jest.Mock } }).search.code;

    spy.mockResolvedValue({
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
    } satisfies SearchCodeResponse);

    const items = await searchInRepo({
      query: 'foo',
      per_page: 10,
      page: 3,
    });

    expect(items).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        q: 'foo',
        per_page: 10,
        page: 3,
      }),
    );
  });

  it('caches identical requests (same q/per_page/page)', async () => {
    const spy = (github as unknown as { search: { code: jest.Mock } }).search.code;

    spy.mockResolvedValue({
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
    } satisfies SearchCodeResponse);

    const args = { query: 'foo', per_page: 10, page: 1 };

    const r1 = await searchInRepo(args);
    const r2 = await searchInRepo(args);

    expect(r1).toEqual(r2);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('deduplicates inflight requests', async () => {
    const spy = (github as unknown as { search: { code: jest.Mock } }).search.code;

    let resolveFn: ((v: SearchCodeResponse) => void) | null = null;

    spy.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve;
        }),
    );

    const args = { query: 'bar', per_page: 10, page: 1 };

    const p1 = searchInRepo(args);
    const p2 = searchInRepo(args);

    expect(spy).toHaveBeenCalledTimes(1);

    resolveFn!({
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
    } satisfies SearchCodeResponse);

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

    const spy = (github as unknown as { search: { code: jest.Mock } }).search.code;

    const nowSec = Math.floor(Date.now() / 1000);
    const resetSec = nowSec + 1;

    spy
      .mockRejectedValueOnce(makeRateLimitError(resetSec))
      .mockResolvedValueOnce({
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
      } satisfies SearchCodeResponse);

    const promise = searchInRepo({
      query: 'baz',
      per_page: 10,
      page: 1,
    });

    // Let the retry timer elapse
    await jest.advanceTimersByTimeAsync(1500);

    const res = await promise;

    expect(res).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });
});
