import type { RepoConfig } from '../config/repos';
import { upsertRepoConfig } from '../config/repos';
import { getGithubClient, parseRepo } from '../github';

export type RepoRegistrationArgs = {
  repo: string; // owner/name
  defaultBranch: string;
  vercel: {
    projectIdEnv: string;
    teamIdEnv?: string;
  };
};

function assertNonEmpty(label: string, v: unknown): asserts v is string {
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function normalizeRepo(repo: string): { fullName: string; owner: string; name: string } {
  const r = repo.trim();
  const parts = r.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('repo must be in the form "owner/name"');
  }
  return { fullName: `${parts[0]}/${parts[1]}`, owner: parts[0], name: parts[1] };
}

async function getRepoOwnerLogin(owner: string, repo: string): Promise<string> {
  const github = getGithubClient();
  const res = await github.repos.get({ owner, repo });
  const ownerLogin = res.data?.owner?.login;
  if (typeof ownerLogin !== 'string' || !ownerLogin) {
    throw new Error('Failed to determine repo owner from GitHub API response');
  }
  return ownerLogin;
}

async function getAuthenticatedUserLogin(): Promise<string> {
  const github = getGithubClient();
  const res = await github.users.getAuthenticated();
  const login = res.data?.login;
  if (typeof login !== 'string' || !login) {
    throw new Error('Failed to determine authenticated GitHub user');
  }
  return login;
}

export const repoRegistrationToolSchema = {
  type: 'function',
  function: {
    name: 'repo_register',
    description:
      'Owner-only: register or update a repository in config/repos.yml allowlist (including Vercel env mapping).',
    parameters: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'GitHub repository in the form owner/name.',
        },
        defaultBranch: {
          type: 'string',
          description: 'Default branch to use for this repository.',
        },
        vercel: {
          type: 'object',
          properties: {
            projectIdEnv: {
              type: 'string',
              description:
                'Name of env var containing Vercel projectId for this repo.',
            },
            teamIdEnv: {
              type: 'string',
              description:
                'Name of env var containing Vercel teamId for this repo (optional).',
            },
          },
          required: ['projectIdEnv'],
        },
      },
      required: ['repo', 'defaultBranch', 'vercel'],
    },
  },
} as const;

export async function repo_register(args: RepoRegistrationArgs) {
  const { fullName: repo, owner, name } = normalizeRepo(args.repo);
  assertNonEmpty('defaultBranch', args.defaultBranch);
  assertNonEmpty('vercel.projectIdEnv', args.vercel?.projectIdEnv);
  if (args.vercel?.teamIdEnv !== undefined) {
    assertNonEmpty('vercel.teamIdEnv', args.vercel.teamIdEnv);
  }

  // Security (per spec): only allow registering repos that belong to the same owner
  // as the authenticated GitHub token.
  const [repoOwner, authedLogin] = await Promise.all([
    getRepoOwnerLogin(owner, name),
    getAuthenticatedUserLogin(),
  ]);

  if (repoOwner !== authedLogin) {
    throw new Error(
      `Refusing to register repo "${repo}" because it is owned by "${repoOwner}" while authenticated GitHub user is "${authedLogin}".`,
    );
  }

  // Also ensure repo is syntactically valid in our internal parser.
  // This does NOT need to be allowlisted yet.
  parseRepo(repo);

  const nextEntry: RepoConfig = {
    repo,
    defaultBranch: args.defaultBranch.trim(),
    vercel: {
      projectIdEnv: args.vercel.projectIdEnv.trim(),
      ...(args.vercel.teamIdEnv ? { teamIdEnv: args.vercel.teamIdEnv.trim() } : {}),
    },
  };

  return upsertRepoConfig(nextEntry);
}
