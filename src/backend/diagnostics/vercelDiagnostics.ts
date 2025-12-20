import { getRepoConfig } from '../config/repos';
import {
  findDeploymentByGit,
  getDeploymentStatus,
  type VercelContext,
} from '../vercel';
import type { VercelTarget } from '../vercelNormalize';

export type VercelDeploymentDiagnosis = {
  repo?: string;
  git_sha?: string;
  target: VercelTarget;
  matchedBy: 'sha' | 'branch_time_window' | 'latest' | 'none';

  deploymentId?: string;
  state?: string | null;
  readyState?: string | null;
  url?: string | null;

  inspectorUrl?: string | null;
  // there isn't always a dedicated logsUrl in the API, so we treat inspector as primary
  logsUrl?: string | null;

  summary: string;
  hints: string[];
};

// Exported for tools layer: allows resolving per-repo Vercel project/team overrides.
export function getVercelContextFromRepo(repo?: string): VercelContext {
  if (!repo) return {};

  const cfg = getRepoConfig(repo);
  if (!cfg) {
    throw new Error(
      `Repo "${repo}" is not configured in config/repos.yml. Add it to the allowlist to enable Vercel operations.`,
    );
  }

  const projectIdEnv = cfg.vercel?.projectIdEnv;
  const teamIdEnv = cfg.vercel?.teamIdEnv;

  if (!projectIdEnv) {
    throw new Error(
      `Repo "${repo}" has no vercel.projectIdEnv in config/repos.yml. Configure it to enable Vercel operations.`,
    );
  }

  const projectId = process.env[projectIdEnv];
  if (!projectId) {
    throw new Error(
      `Missing env ${projectIdEnv} for repo "${repo}". Set it on the Vercel project running BotCow backend.`,
    );
  }

  const teamId = teamIdEnv ? process.env[teamIdEnv] : undefined;

  // exactOptionalPropertyTypes: do not pass keys with undefined
  return {
    projectId,
    ...(teamId ? { teamId } : {}),
  };
}

export async function diagnoseVercelDeployment(args: {
  repo?: string;
  git_sha?: string;
  branch?: string;
  target?: VercelTarget;
  timeWindowMinutes?: number;
}): Promise<VercelDeploymentDiagnosis> {
  // Per docs/spec.md: all Vercel tools operate in preview only.
  const target: VercelTarget = 'preview';
  const ctx = getVercelContextFromRepo(args.repo);

  if (!args.git_sha) {
    return {
      ...(args.repo ? { repo: args.repo } : {}),
      target,
      matchedBy: 'none',
      summary:
        'git_sha is required to reliably find a Vercel deployment. Provide a commit SHA (or use fallback by branch/time window explicitly).',
      hints: [
        'Provide git_sha (commit SHA) to match deployments by metadata.',
        'If sha matching is unavailable, provide branch + timeWindowMinutes to use documented fallback strategy.',
      ],
    };
  }

  const found = await findDeploymentByGit(
    {
      gitSha: args.git_sha,
      target,
      ...(args.branch ? { branch: args.branch } : {}),
      ...(args.timeWindowMinutes !== undefined
        ? { timeWindowMinutes: args.timeWindowMinutes }
        : {}),
      limit: 30,
    },
    ctx,
  );

  if (!found) {
    return {
      ...(args.repo ? { repo: args.repo } : {}),
      git_sha: args.git_sha,
      target,
      matchedBy: 'none',
      summary: 'No deployments found in Vercel for this project/team.',
      hints: [
        'Check that VERCEL_TOKEN has access to the project/team.',
        'Check that repo config maps to the correct Vercel projectId/teamId env keys.',
      ],
    };
  }

  const deploymentId = found.id;
  const details = deploymentId ? await getDeploymentStatus(deploymentId, ctx) : found;

  const url = details.url;
  const state = details.state;
  const readyState = details.readyState;
  const inspectorUrl = details.inspectorUrl;

  const hints: string[] = [];
  if (!inspectorUrl) {
    hints.push(
      'inspectorUrl is not available from the API for this deployment. Use the Vercel dashboard deployment page to view logs.',
    );
  }

  const summaryParts = [
    `Vercel ${target} deployment: ${readyState ?? state ?? 'unknown'}`,
    `matchedBy: latest`,
  ];

  return {
    ...(args.repo ? { repo: args.repo } : {}),
    git_sha: args.git_sha,
    target,
    matchedBy: 'latest',
    deploymentId,
    state,
    readyState,
    url,
    inspectorUrl,
    logsUrl: inspectorUrl,
    summary: summaryParts.join(' | '),
    hints,
  };
}
