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

export type GithubSearchTypeEnumValue = {
  name: string;
};

/**
 * Self-check for GitHub GraphQL schema: lists enum values for SearchType.
 *
 * GitHub GraphQL historically does NOT include CODE in SearchType for many tokens/apps,
 * so code search must use REST /search/code.
 */
export async function githubSearchTypeEnumValuesGraphql(): Promise<GithubSearchTypeEnumValue[]> {
  const github = getGithubClient();

  const QUERY = `
    query SearchTypeEnumValues {
      __type(name: "SearchType") {
        enumValues {
          name
        }
      }
    }
  `;

  const data = await (github as any).graphql(QUERY, {});

  const values = (data?.__type?.enumValues ?? []) as any[];
  const enumValues: GithubSearchTypeEnumValue[] = values
    .filter(Boolean)
    .map((v) => ({ name: String(v.name) }));

  await logEvent('github_graphql_searchtype_enum_values', {
    values: enumValues.map((v) => v.name),
  }).catch(() => undefined);

  return enumValues;
}

// -----------------------
// Deprecated code-search via GraphQL
// -----------------------

export type GithubSearchItem = {
  path: string;
  repository: string;
  url: string;
};

/**
 * @deprecated GitHub GraphQL code search is not supported (SearchType lacks CODE).
 * Use REST search in `searchInRepo` instead.
 */
export async function githubCodeSearchGraphql(_options: {
  owner: string;
  repo: string;
  query: string;
  path?: string;
  per_page?: number;
}): Promise<GithubSearchItem[]> {
  await logEvent('github_graphql_code_search_disabled', {}).catch(() => undefined);
  return [];
}
