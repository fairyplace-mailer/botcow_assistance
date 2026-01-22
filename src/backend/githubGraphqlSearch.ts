import { getGithubClient } from './github';
import { logEvent } from './log';

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function normalizeQuery(q: string) {
  return q.trim().replace(/\s+/g, ' ');
}

function buildSearchQuery(args: {
  query: string;
  owner: string;
  repo: string;
  path?: string;
}) {
  const baseQuery = normalizeQuery(args.query);

  const hasRepoQualifier = /(^|\s)repo:/.test(baseQuery);
  const hasPathQualifier = /(^|\s)path:/.test(baseQuery);

  let q = baseQuery;
  if (!hasRepoQualifier) {
    q += ` repo:${args.owner}/${args.repo}`;
  }
  if (args.path && !hasPathQualifier) {
    q += ` path:${args.path}`;
  }

  return q;
}

function getHeaderValue(headers: any, name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  return headers[name] ?? headers[lower];
}

function isSecondaryRateLimitError(error: any): boolean {
  const msg =
    (typeof error?.message === 'string' ? error.message : '') +
    ' ' +
    (typeof error?.response?.data?.message === 'string'
      ? error.response.data.message
      : '');
  return /secondary rate limit/i.test(msg);
}

export type GithubSearchItem = {
  path: string;
  repository: string;
  url: string;
};

const SEARCH_QUERY = `
  query CodeSearch($q: String!, $first: Int!) {
    rateLimit {
      remaining
      resetAt
    }
    search(type: CODE, query: $q, first: $first) {
      codeCount
      nodes {
        __typename
        ... on Code {
          path
          url
          repository { nameWithOwner }
        }
      }
    }
  }
`;

async function searchCodeGraphqlOnce(args: { q: string; first: number }) {
  const github = getGithubClient();
  // Octokit graphql client is exposed as `octokit.graphql`.
  // NOTE: variable name `query` is reserved in @octokit/graphql, so we use `q`.
  return await (github as any).graphql(SEARCH_QUERY, {
    q: args.q,
    first: args.first,
  });
}

async function searchCodeGraphqlWithRetry(args: { q: string; first: number }) {
  const maxRetries = 4;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await searchCodeGraphqlOnce(args);
    } catch (error: any) {
      const status = error?.status ?? error?.response?.status;
      const headers = error?.response?.headers;

      const remainingStr = getHeaderValue(headers, 'x-ratelimit-remaining');
      const resetStr = getHeaderValue(headers, 'x-ratelimit-reset');
      const remaining =
        remainingStr !== undefined ? Number.parseInt(remainingStr, 10) : undefined;
      const resetSec =
        resetStr !== undefined ? Number.parseInt(resetStr, 10) : undefined;

      const isRateLimitExceeded = status === 403 && remaining === 0;
      const isSecondary = status === 403 && isSecondaryRateLimitError(error);

      if (attempt >= maxRetries || (!isRateLimitExceeded && !isSecondary)) {
        throw error;
      }

      if (isRateLimitExceeded && resetSec) {
        const resetMs = resetSec * 1000;
        const now = Date.now();
        const jitterMs = 100 + Math.floor(Math.random() * 400);
        const waitMs = Math.max(0, resetMs - now) + jitterMs;
        await logEvent('github_graphql_search_rate_limited_wait', {
          attempt,
          waitMs,
          remaining,
          resetSec,
        }).catch(() => undefined);
        await sleep(waitMs);
        continue;
      }

      const backoffMs = Math.min(20000, 1000 * 2 ** attempt);
      await logEvent('github_graphql_search_secondary_rate_limit_backoff', {
        attempt,
        backoffMs,
      }).catch(() => undefined);
      await sleep(backoffMs);
    }
  }

  throw new Error('searchCodeGraphqlWithRetry: exhausted');
}

export async function githubCodeSearchGraphql(options: {
  owner: string;
  repo: string;
  query: string;
  path?: string;
  per_page?: number;
}): Promise<GithubSearchItem[]> {
  const first = clampInt(options.per_page, 1, 50, 20);
  const q = buildSearchQuery({
    query: options.query,
    owner: options.owner,
    repo: options.repo,
    ...(options.path ? { path: options.path } : {}),
  });

  const data = await searchCodeGraphqlWithRetry({ q, first });
  const nodes = (data?.search?.nodes ?? []) as any[];

  const items: GithubSearchItem[] = [];
  for (const n of nodes) {
    if (!n) continue;
    if (n.__typename !== 'Code') continue;
    items.push({
      path: n.path,
      repository: n.repository?.nameWithOwner,
      url: n.url,
    });
  }

  return items;
}
