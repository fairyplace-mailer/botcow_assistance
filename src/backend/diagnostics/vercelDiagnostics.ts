import { getRepoConfig } from '../config/repos';
import {
  findDeploymentByGit,
  getDeploymentStatus,
  type VercelContext,
  type VercelTarget,
} from '../vercel';

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

function getVercelContextFromRepo(repo?: string): VercelContext {
  if (!repo) return {};
  const cfg = getRepoConfig(repo);
  const projectIdEnv = cfg?.vercel?.projectIdEnv;
  const teamIdEnv = cfg?.vercel?.teamIdEnv;

  return {
    projectId: projectIdEnv ? process.env[projectIdEnv] : undefined,
    teamId: teamIdEnv ? process.env[teamIdEnv] : undefined,
  };
}

export async function diagnoseVercelDeployment(args: {
  repo?: string;
  git_sha?: string;
  branch?: string;
  target?: VercelTarget;
  timeWindowMinutes?: number;
}): Promise<VercelDeploymentDiagnosis> {
  const target: VercelTarget = args.target === 'production' ? 'production' : 'preview';
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

  const raw = found.deployment as any;
  const deploymentId: string | undefined =
    typeof raw.id === 'string'
      ? raw.id
      : typeof raw.uid === 'string'
        ? raw.uid
        : undefined;

  const details = deploymentId ? await getDeploymentStatus(deploymentId, ctx) : raw;

  const url = typeof (details as any).url === 'string' ? (details as any).url : null;
  const state =
    typeof (details as any).state === 'string'
      ? (details as any).state
      : typeof (details as any).status === 'string'
        ? (details as any).status
        : null;
  const readyState =
    typeof (details as any).readyState === 'string'
      ? (details as any).readyState
      : state;

  const inspectorUrl =
    typeof (details as any).inspectorUrl === 'string'
      ? (details as any).inspectorUrl
      : null;

  const hints: string[] = [];
  if (!inspectorUrl) {
    hints.push(
      'inspectorUrl is not available from the API for this deployment. Use the Vercel dashboard deployment page to view logs.',
    );
  }

  const summaryParts = [
    `Vercel ${target} deployment: ${readyState ?? state ?? 'unknown'}`,
    `matchedBy: ${found.matchedBy}`,
  ];

  return {
    ...(args.repo ? { repo: args.repo } : {}),
    git_sha: args.git_sha,
    target,
    matchedBy: found.matchedBy,
    ...(deploymentId ? { deploymentId } : {}),
    state,
    readyState,
    url,
    inspectorUrl,
    logsUrl: inspectorUrl,
    summary: summaryParts.join(' | '),
    hints,
  };
}
