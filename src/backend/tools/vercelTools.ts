import { getRepoConfig } from '../config/repos';
import {
  getLatestDeployments,
  getDeploymentStatus,
  triggerDeploy,
  redeploy,
  type VercelTarget,
  listDeployments,
  getRuntimeLogs,
} from '../vercel';
import {
  getVercelContextFromRepo,
  diagnoseVercelDeployment,
} from '../diagnostics/vercelDiagnostics';
import { normalizeVercelDeployment } from '../vercelNormalize';

export interface VercelGetLatestDeploymentsArgs {
  target?: VercelTarget;
  limit?: number;
  repo?: string;
}

export interface VercelGetDeploymentStatusArgs {
  deployment_id: string;
  repo?: string;
}

export interface VercelTriggerDeployArgs {
  project_id?: string;
  git_commit_sha?: string;
  target?: VercelTarget;
  repo?: string;
}

export interface VercelRedeployArgs {
  deployment_id: string;
  target?: VercelTarget;
  repo?: string;
}

export interface VercelDiagnoseDeploymentArgs {
  repo?: string;
  git_sha?: string;
  branch?: string;
  target?: VercelTarget;
  timeWindowMinutes?: number;
}

export interface VercelListDeploymentsArgs {
  repo?: string;
  branch?: string;
  gitSha?: string;
  since?: string;
  until?: string;
  limit?: number;
  target?: VercelTarget;
}

export interface VercelGetRuntimeLogsArgs {
  repo?: string;
  deploymentId: string;
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
}

export interface VercelSearchRuntimeLogsArgs extends VercelGetRuntimeLogsArgs {
  query?: string;
  level?: 'info' | 'warn' | 'error';
  route?: string;
  functionName?: string;
}

function getVercelCtxFromRepo(repo?: string) {
  if (!repo) return undefined;

  const ctx = getVercelContextFromRepo(repo);
  const cfg = getRepoConfig(repo);

  const gitRef = cfg?.defaultBranch;

  return {
    ...ctx,
    ...(gitRef ? { gitRef } : {}),
  };
}

function requirePreviewTarget(target?: VercelTarget): VercelTarget {
  if (!target) return 'preview';
  if (target === 'preview') return 'preview';
  throw new Error('Production deploys are disabled (preview only)');
}

export const vercelToolsSchemas = [
  {
    type: 'function',
    function: {
      name: 'vercel_get_latest_deployments',
      description: 'Get latest deployments from Vercel (preview only).',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            enum: ['preview'],
            description: 'Target environment. Only preview is allowed.',
          },
          limit: {
            type: 'number',
            description: 'How many deployments to return (default 5).',
          },
          repo: {
            type: 'string',
            description:
              'owner/name. If set — use Vercel project/team from config/repos.yml.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'vercel_list_deployments',
      description: 'List Vercel preview deployments with optional filters by repo, branch, git sha, and time window.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string' },
          branch: { type: 'string' },
          gitSha: { type: 'string' },
          since: { type: 'string', description: 'ISO timestamp lower bound.' },
          until: { type: 'string', description: 'ISO timestamp upper bound.' },
          limit: { type: 'number' },
          target: { type: 'string', enum: ['preview'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'vercel_get_runtime_logs',
      description: 'Get Vercel runtime logs for a deploymentId with time range and pagination.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string' },
          deploymentId: { type: 'string' },
          since: { type: 'string', description: 'ISO timestamp lower bound.' },
          until: { type: 'string', description: 'ISO timestamp upper bound.' },
          limit: { type: 'number' },
          cursor: { type: 'string' },
        },
        required: ['deploymentId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'vercel_search_runtime_logs',
      description: 'Search Vercel runtime logs by text, level, route, or function name.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string' },
          deploymentId: { type: 'string' },
          query: { type: 'string' },
          level: { type: 'string', enum: ['info', 'warn', 'error'] },
          route: { type: 'string' },
          functionName: { type: 'string' },
          since: { type: 'string', description: 'ISO timestamp lower bound.' },
          until: { type: 'string', description: 'ISO timestamp upper bound.' },
          limit: { type: 'number' },
          cursor: { type: 'string' },
        },
        required: ['deploymentId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'vercel_get_deployment_status',
      description: 'Get Vercel deployment status by deployment_id.',
      parameters: {
        type: 'object',
        properties: {
          deployment_id: {
            type: 'string',
            description: 'Vercel deployment id.',
          },
          repo: {
            type: 'string',
            description:
              'owner/name. If set — use Vercel team/project from config/repos.yml.',
          },
        },
        required: ['deployment_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'vercel_trigger_deploy',
      description:
        'Trigger a Vercel deployment (preview only). Optionally specify git sha and/or project_id.',
      parameters: {
        type: 'object',
        properties: {
          project_id: {
            type: 'string',
            description:
              'Vercel projectId (override). If omitted — resolved from repo config/env.',
          },
          git_commit_sha: {
            type: 'string',
            description: 'Git commit SHA (for matching/diagnostics).',
          },
          target: {
            type: 'string',
            enum: ['preview'],
            description: 'Target environment. Only preview is allowed.',
          },
          repo: {
            type: 'string',
            description:
              'owner/name. If set — use Vercel project/team from config/repos.yml.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'vercel_redeploy',
      description: 'Redeploy a Vercel deployment (preview only) by deployment_id.',
      parameters: {
        type: 'object',
        properties: {
          deployment_id: {
            type: 'string',
            description: 'Vercel deployment id.',
          },
          target: {
            type: 'string',
            enum: ['preview'],
            description: 'Target environment. Only preview is allowed.',
          },
          repo: {
            type: 'string',
            description:
              'owner/name. If set — use Vercel team/project from config/repos.yml.',
          },
        },
        required: ['deployment_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'vercel_diagnose_deployment',
      description: 'Diagnose Vercel deployment for a given git sha (preview only).',
      parameters: {
        type: 'object',
        properties: {
          repo: {
            type: 'string',
            description: 'owner/name; used to resolve Vercel project/team from config.',
          },
          git_sha: {
            type: 'string',
            description: 'Git commit SHA to match deployment by metadata.',
          },
          branch: {
            type: 'string',
            description: 'Fallback branch name to match deployments in a time window.',
          },
          target: {
            type: 'string',
            enum: ['preview'],
            description: 'Target environment. Only preview is allowed.',
          },
          timeWindowMinutes: {
            type: 'number',
            description:
              'Fallback time window (minutes) when matching by branch. Default 180.',
          },
        },
      },
    },
  },
] as const;

export const vercelToolHandlers = {
  async vercel_get_latest_deployments(args: VercelGetLatestDeploymentsArgs) {
    const limit = args.limit ?? 5;
    const env: VercelTarget = requirePreviewTarget(args.target);

    const ctx = getVercelCtxFromRepo(args.repo);
    const deployments = await getLatestDeployments(env, ctx, limit);

    return {
      target: env,
      deployments: (Array.isArray(deployments) ? deployments : []).slice(0, limit),
    };
  },

  async vercel_list_deployments(args: VercelListDeploymentsArgs) {
    const target: VercelTarget = requirePreviewTarget(args.target);
    const ctx = getVercelCtxFromRepo(args.repo);
    const deployments = await listDeployments({ ...args, target }, ctx);

    return {
      target,
      count: deployments.length,
      deployments,
    };
  },

  async vercel_get_runtime_logs(args: VercelGetRuntimeLogsArgs) {
    const ctx = getVercelCtxFromRepo(args.repo);
    return getRuntimeLogs(
      {
        deploymentId: args.deploymentId,
        ...(args.since ? { since: args.since } : {}),
        ...(args.until ? { until: args.until } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
        ...(args.cursor ? { cursor: args.cursor } : {}),
      },
      ctx,
    );
  },

  async vercel_search_runtime_logs(args: VercelSearchRuntimeLogsArgs) {
    const ctx = getVercelCtxFromRepo(args.repo);
    const result = await getRuntimeLogs(
      {
        deploymentId: args.deploymentId,
        ...(args.since ? { since: args.since } : {}),
        ...(args.until ? { until: args.until } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
        ...(args.cursor ? { cursor: args.cursor } : {}),
      },
      ctx,
    );

    const query = args.query?.toLowerCase();
    const route = args.route?.toLowerCase();
    const functionName = args.functionName?.toLowerCase();
    const level = args.level?.toLowerCase();

    const logs = result.logs.filter((log) => {
      if (query && !(log.message ?? '').toLowerCase().includes(query)) return false;
      if (level && (log.level ?? '').toLowerCase() !== level) return false;
      if (route && !((log.route ?? '').toLowerCase().includes(route))) return false;
      if (functionName && !((log.functionName ?? '').toLowerCase().includes(functionName))) return false;
      return true;
    });

    return {
      deploymentId: result.deploymentId,
      count: logs.length,
      logs,
      pagination: result.pagination,
    };
  },

  async vercel_get_deployment_status(args: VercelGetDeploymentStatusArgs) {
    const ctx = getVercelCtxFromRepo(args.repo);
    const raw = await getDeploymentStatus(args.deployment_id, ctx);
    return normalizeVercelDeployment(raw as any);
  },

  async vercel_trigger_deploy(args: VercelTriggerDeployArgs) {
    const target: VercelTarget = requirePreviewTarget(args.target);

    const ctx = getVercelCtxFromRepo(args.repo);
    const raw = await triggerDeploy(
      args.project_id,
      args.git_commit_sha,
      target,
      ctx,
    );
    return normalizeVercelDeployment(raw as any);
  },

  async vercel_redeploy(args: VercelRedeployArgs) {
    const target: VercelTarget = requirePreviewTarget(args.target);

    const ctx = getVercelCtxFromRepo(args.repo);
    const raw = await redeploy(args.deployment_id, target, ctx);
    return normalizeVercelDeployment(raw as any);
  },

  async vercel_diagnose_deployment(args: VercelDiagnoseDeploymentArgs) {
    const target: VercelTarget = requirePreviewTarget(args.target);

    return diagnoseVercelDeployment({
      ...(args.repo ? { repo: args.repo } : {}),
      ...(args.git_sha ? { git_sha: args.git_sha } : {}),
      ...(args.branch ? { branch: args.branch } : {}),
      ...(target ? { target } : {}),
      ...(args.timeWindowMinutes !== undefined
        ? { timeWindowMinutes: args.timeWindowMinutes }
        : {}),
    });
  },
};
