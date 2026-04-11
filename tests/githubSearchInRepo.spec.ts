import {
  __resetGithubClientForTests,
  __resetSearchStateForTests,
  __setGithubClientForTests,
  searchInRepo,
} from '../src/backend/github';

jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({
    search: {
      code: jest.fn(),
    },
  })),
}));

describe('searchInRepo', () => {
  const gql = jest.fn();
  const restCode = jest.fn();

  beforeEach(() => {
    __resetSearchStateForTests();
    __resetGithubClientForTests();
    gql.mockReset();
    restCode.mockReset();
  });

  test('returns normalized search results', async () => {
    __setGithubClientForTests({
      graphql: gql,
      search: {
        code: restCode,
      },
    } as any);

    gql.mockResolvedValueOnce({
      __type: {
        enumValues: [{ name: 'CODE' }],
      },
    });

    gql.mockResolvedValueOnce({
      search: {
        edges: [
          {
            node: {
              path: 'src/index.ts',
              repository: {
                nameWithOwner: 'fairyplace-mailer/botcow_assistance',
              },
            },
          },
        ],
        pageInfo: {
          hasNextPage: false,
          endCursor: null,
        },
        repositoryCount: 1,
        codeCount: 1,
      },
    });

    const result = await searchInRepo({
      query: 'hello',
      repo: 'fairyplace-mailer/botcow_assistance',
      path: 'src',
      per_page: 1,
      page: 1,
    });

    expect(result.items).toEqual([
      {
        path: 'src/index.ts',
        repository: 'fairyplace-mailer/botcow_assistance',
      },
    ]);

    expect(gql).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('query SearchCode'),
      expect.objectContaining({ query: 'hello repo:fairyplace-mailer/botcow_assistance path:src', first: 1 }),
    );
    expect(restCode).not.toHaveBeenCalled();
  });

  test('falls back to REST search when requesting page > 1', async () => {
    __setGithubClientForTests({
      graphql: gql,
      search: {
        code: restCode,
      },
    } as any);

    restCode.mockResolvedValueOnce({
      data: {
        items: [
          {
            path: 'src/other.ts',
            repository: { full_name: 'fairyplace-mailer/botcow_assistance' },
            score: 12.5,
            html_url: 'https://github.com/fairyplace-mailer/botcow_assistance/blob/main/src/other.ts',
          },
        ],
      },
    });

    const result = await searchInRepo({
      query: 'needle',
      repo: 'fairyplace-mailer/botcow_assistance',
      per_page: 10,
      page: 2,
    });

    expect(result.items).toEqual([
      {
        path: 'src/other.ts',
        repository: 'fairyplace-mailer/botcow_assistance',
        score: 12.5,
        url: 'https://github.com/fairyplace-mailer/botcow_assistance/blob/main/src/other.ts',
      },
    ]);
    expect(gql).not.toHaveBeenCalled();
    expect(restCode).toHaveBeenCalledWith({
      q: 'needle repo:fairyplace-mailer/botcow_assistance',
      per_page: 10,
      page: 2,
    });
  });

    test('uses first >= 1 in graphql search for page 1', async () => {
    __setGithubClientForTests({
      graphql: gql,
    } as any);

    gql.mockResolvedValueOnce({
      __type: {
        enumValues: [{ name: 'CODE' }],
      },
    });

    gql.mockResolvedValueOnce({
      search: {
        edges: [],
      },
    });

    await searchInRepo({
      query: 'hello',
      repo: 'fairyplace-mailer/botcow_assistance',
      per_page: 20,
      page: 1,
    });

    expect(gql).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('query SearchCode'),
      expect.objectContaining({
        query: 'hello repo:fairyplace-mailer/botcow_assistance',
        first: 20,
      }),
    );
  });

  test('falls back to REST when graphql code search fails', async () => {
    const restSearch = jest.fn().mockResolvedValue({
      data: {
        items: [
          {
            path: 'docs/strong_spec.md',
            repository: { full_name: 'fairyplace-mailer/botcow_assistance' },
            score: 1,
            html_url: 'https://example.test/spec',
          },
        ],
      },
    });

    __setGithubClientForTests({
      graphql: gql,
      search: {
        code: restSearch,
      },
    } as any);

    gql.mockResolvedValueOnce({
      __type: {
        enumValues: [{ name: 'CODE' }],
      },
    });
    gql.mockRejectedValueOnce(new Error('GraphQL CODE search failed'));

    const result = await searchInRepo({
      query: 'strict mode',
      repo: 'fairyplace-mailer/botcow_assistance',
      per_page: 5,
      page: 1,
    });

    expect(restSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'strict mode repo:fairyplace-mailer/botcow_assistance',
        per_page: 5,
        page: 1,
      }),
    );
    expect(result.items).toEqual([
      {
        path: 'docs/strong_spec.md',
        repository: 'fairyplace-mailer/botcow_assistance',
        score: 1,
        url: 'https://example.test/spec',
      },
    ]);
  });

  test('uses REST for page > 1', async () => {
    const restSearch = jest.fn().mockResolvedValue({
      data: { items: [] },
    });

    __setGithubClientForTests({
      graphql: gql,
      search: {
        code: restSearch,
      },
    } as any);

    await searchInRepo({
      query: 'audit',
      repo: 'fairyplace-mailer/botcow_assistance',
      per_page: 10,
      page: 2,
    });

    expect(restSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'audit repo:fairyplace-mailer/botcow_assistance',
        per_page: 10,
        page: 2,
      }),
    );
    expect(gql).not.toHaveBeenCalled();
  });
});
