import { __resetSearchStateForTests, getGithubClient, searchInRepo } from '../src/backend/github';

jest.mock('../src/backend/github', () => {
  const actual = jest.requireActual('../src/backend/github');

  // Provide a stable mock Octokit-like client for tests.
  const mockClient = {
    search: { code: jest.fn() },
  };

  return {
    ...actual,
    getGithubClient: jest.fn(() => mockClient),
  };
});

function makeRateLimitError(resetSec: number) {
  const err: any = new Error('rate limit exceeded');
  err.status = 403;
  err.response = {
    status: 403,
    headers: {
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(resetSec),
    },
    data: { message: 'API rate limit exceeded' },
  };
  return err;
}

describe('searchInRepo', () => {
  beforeEach(() => {
    __resetSearchStateForTests();
    jest.restoreAllMocks();
    jest.useRealTimers();

    // Reset calls on our mocked client between tests.
    const github = getGithubClient() as any;
    github.search.code.mockReset();
  });

  it('passes page to github.search.code', async () => {
    const github = getGithubClient() as any;
    const spy = jest.spyOn(github.search, 'code').mockResolvedValue({
      data: {
        items: [
          {
            path: 'a.ts',
            repository: { full_name: 'o/r' },
            score: 1,
            html_url: 'https://example.com',
          },
        ],
      },
    } as any);

    const items = await searchInRepo({
      repo: 'fairyplace-mailer/botcow_assistance',
      query: 'foo',
      per_page: 10,
      page: 2,
    });

    expect(items).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        page: 2,
        per_page: 10,
      }),
    );
  });

  it('caches identical requests (same q/per_page/page)', async () => {
    const github = getGithubClient() as any;
    const spy = jest.spyOn(github.search, 'code').mockResolvedValue({
      data: {
        items: [
          {
            path: 'a.ts',
            repository: { full_name: 'o/r' },
            score: 1,
            html_url: 'https://example.com',
          },
        ],
      },
    } as any);

    const args = {
      repo: 'fairyplace-mailer/botcow_assistance',
      query: 'foo',
      per_page: 10,
      page: 1,
    };

    const r1 = await searchInRepo(args);
    const r2 = await searchInRepo(args);

    expect(r1).toEqual(r2);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('deduplicates inflight requests', async () => {
    const github = getGithubClient() as any;
    let resolveFn: ((v: any) => void) | null = null;

    const spy = jest.spyOn(github.search, 'code').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve;
        }),
    );

    const args = {
      repo: 'fairyplace-mailer/botcow_assistance',
      query: 'foo',
      per_page: 10,
      page: 1,
    };

    const p1 = searchInRepo(args);
    const p2 = searchInRepo(args);

    expect(spy).toHaveBeenCalledTimes(1);

    resolveFn!({
      data: {
        items: [
          {
            path: 'a.ts',
            repository: { full_name: 'o/r' },
            score: 1,
            html_url: 'https://example.com',
          },
        ],
      },
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(r2);
  });

  it('retries on rate limit exceeded using x-ratelimit-reset', async () => {
    jest.useFakeTimers();

    const nowSec = Math.floor(Date.now() / 1000);
    const resetSec = nowSec + 1;

    const github = getGithubClient() as any;
    const spy = jest
      .spyOn(github.search, 'code')
      .mockRejectedValueOnce(makeRateLimitError(resetSec))
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              path: 'a.ts',
              repository: { full_name: 'o/r' },
              score: 1,
              html_url: 'https://example.com',
            },
          ],
        },
      } as any);

    const promise = searchInRepo({
      repo: 'fairyplace-mailer/botcow_assistance',
      query: 'foo',
      per_page: 10,
      page: 1,
    });

    // advance enough for wait + jitter
    await jest.advanceTimersByTimeAsync(2500);

    const res = await promise;

    expect(res).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
