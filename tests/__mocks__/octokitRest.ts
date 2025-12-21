type SearchCodeCall = { q: string; per_page?: number; page?: number };

type MockResponse<T> = { data: T };

export class Octokit {
  public search: {
    code: (args: SearchCodeCall) => Promise<MockResponse<{ items: any[] }>>;
  };

  // Minimal subset used in this repo; can be extended per-test.
  public repos: any;
  public git: any;
  public pulls: any;
  public issues: any;
  public actions: any;

  constructor() {
    this.search = {
      code: async () => ({ data: { items: [] } }),
    };

    // Other namespaces are not needed for these tests.
    this.repos = {};
    this.git = {};
    this.pulls = {};
    this.issues = {};
    this.actions = {};
  }
}
