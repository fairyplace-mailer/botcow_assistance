import type { SearchCodeResponse } from '@octokit/types';

jest.mock('../src/backend/github', () => {
  const actual = jest.requireActual('../src/backend/github');

  const mockClient = {
    search: {
      code: jest.fn(),
    },
  };

  return {
    ...actual,
    getGithubClient: jest.fn(() => mockClient),
  };
});

import {
  __resetSearchStateForTests,
  getGithubClient,
  searchInRepo,
} from '../src/backend/github';

describe('searchInRepo', () => {
  beforeEach(() => {
    __resetSearchStateForTests();
    jest.clearAllMocks();
  });

  it('passes page to github.search.code', async () => {
    const mockClient = getGithubClient() as unknown as {
      search: { code: jest.Mock };
    };

    const spy = mockClient.search.code.mockResolvedValue({
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
    const mockClient = getGithubClient() as unknown as {
      search: { code: jest.Mock };
    };

    const spy = mockClient.search.code.mockResolvedValue({
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
    const mockClient = getGithubClient() as unknown as {
      search: { code: jest.Mock };
    };

    let resolveFn: ((v: SearchCodeResponse) => void) | null = null;

    const spy = mockClient.search.code.mockImplementation(
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

    const mockClient = getGithubClient() as unknown as {
      search: { code: jest.Mock };
    };

    const nowSec = Math.floor(Date.now() / 1000);
    const resetSec = nowSec + 1;

    const spy = mockClient.search.code
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
