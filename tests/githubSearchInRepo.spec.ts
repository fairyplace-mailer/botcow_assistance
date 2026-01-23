// Force KV to always miss in tests
jest.mock('../src/backend/kv', () => ({
  kvGetJson: jest.fn(async () => null),
  kvSetJson: jest.fn(async () => undefined),
}));

// Force DB-backed githubCache to always miss in tests (avoid prisma dependency)
jest.mock('../src/backend/githubCache', () => ({
  githubCacheGet: jest.fn(async () => null),
  githubCacheSet: jest.fn(async () => undefined),
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

  function makeClient(graphqlImpl: jest.Mock) {
    return {
      graphql: graphqlImpl,
    } as any;
  }

  function okGraphqlResponse() {
    return {
      search: {
        nodes: [
          {
            __typename: 'Code',
            path: 'p',
            url: 'u',
            repository: { nameWithOwner: 'o/r' },
          },
        ],
      },
    } as any;
  }

  it('calls octokit.graphql with variables { q, first }', async () => {
    const graphql = jest.fn().mockResolvedValue(okGraphqlResponse());
    __setGithubClientForTests(makeClient(graphql));

    const items = await searchInRepo({
      query: 'foo',
      per_page: 10,
      page: 3,
    });

    expect(items).toHaveLength(1);
    expect(graphql).toHaveBeenCalledTimes(1);

    const [queryText, variables] = graphql.mock.calls[0];
    expect(typeof queryText).toBe('string');
    expect(variables).toEqual(
      expect.objectContaining({
        q: expect.stringContaining('foo'),
        first: 10,
      }),
    );
  });

  it('deduplicates inflight requests (same query)', async () => {
    let resolveFn: ((v: any) => void) | null = null;

    const graphql = jest.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve;
        }),
    );

    __setGithubClientForTests(makeClient(graphql));

    const args = { query: 'bar', per_page: 10, page: 1 };

    const p1 = searchInRepo(args);
    const p2 = searchInRepo(args);

    // allow the first call to progress to the point it invokes octokit.graphql
    await Promise.resolve();

    expect(graphql).toHaveBeenCalledTimes(1);

    resolveFn!(okGraphqlResponse());

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

    const graphql = jest
      .fn()
      .mockRejectedValueOnce(makeRateLimitError(resetSec))
      .mockResolvedValueOnce(okGraphqlResponse());

    __setGithubClientForTests(makeClient(graphql));

    const promise = searchInRepo({ query: 'baz', per_page: 10, page: 1 });

    // Let retry timer elapse (includes jitter)
    await jest.advanceTimersByTimeAsync(2500);

    const res = await promise;

    expect(res).toHaveLength(1);
    expect(graphql).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });
});
