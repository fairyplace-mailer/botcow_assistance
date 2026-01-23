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
    // Important: clear Jest mocks first to avoid wiping mock call history after
    // our module-level state reset.
    jest.clearAllMocks();
    __resetSearchStateForTests();
    __resetGithubClientForTests();
  });

  function makeClient(searchCodeImpl: jest.Mock) {
    return {
      search: {
        code: searchCodeImpl,
      },
    } as any;
  }

  function okRestResponse() {
    return {
      data: {
        items: [
          {
            path: 'p',
            html_url: 'u',
            score: 1,
            repository: { full_name: 'o/r' },
          },
        ],
      },
    } as any;
  }

  it('calls octokit.search.code with q/per_page/page', async () => {
    const code = jest.fn().mockResolvedValue(okRestResponse());
    __setGithubClientForTests(makeClient(code));

    const items = await searchInRepo({
      query: 'foo',
      per_page: 10,
      page: 3,
    });

    expect(items).toHaveLength(1);
    expect(code).toHaveBeenCalledTimes(1);

    expect(code).toHaveBeenCalledWith(
      expect.objectContaining({
        q: expect.stringContaining('foo'),
        per_page: 10,
        page: 3,
      }),
    );
  });

  it('deduplicates inflight requests (same query)', async () => {
    let resolveFn: ((v: any) => void) | null = null;

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

    // Wait until the first request has acquired the search slot and invoked
    // octokit.search.code. With the added throttle, this is not guaranteed to
    // happen in a single microtask tick.
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(code).toHaveBeenCalledTimes(1);

    resolveFn!(okRestResponse());

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toEqual(r2);
    expect(r1).toHaveLength(1);
  });
});
