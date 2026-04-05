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

  beforeEach(() => {
    __resetSearchStateForTests();
    __resetGithubClientForTests();
    gql.mockReset();
  });

  test('returns normalized search results', async () => {
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
        edges: [
          {
            node: {
              path: 'src/index.ts',
              repository: {
                nameWithOwner: 'owner/repo',
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
      repo: 'owner/repo',
      path: 'src',
      per_page: 1,
      page: 1,
    });

    expect(result.items).toEqual([
      {
        path: 'src/index.ts',
        repository: 'owner/repo',
      },
    ]);
  });
});
