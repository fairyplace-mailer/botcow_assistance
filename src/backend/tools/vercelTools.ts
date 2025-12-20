import { getRepoConfig } from '../config/repos';
import {
  getLatestDeployments,
  getDeploymentStatus,
  triggerDeploy,
  redeploy,
  type VercelTarget,
} from '../vercel';
import {
  getVercelContextFromRepo,
  diagnoseVercelDeployment,
} from '../diagnostics/vercelDiagnostics';
import {
  normalizeVercelDeployment,
  type NormalizedVercelDeployment,
} from '../vercelNormalize';

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

function normalizeDeployment(raw: any): NormalizedVercelDeployment {
  return normalizeVercelDeployment(raw);
}

function getVercelCtxFromRepo(repo?: string) {
  if (!repo) return undefined;

  const ctx = getVercelContextFromRepo(repo);
  const cfg = getRepoConfig(repo);

  // Note: cfg is guaranteed here because getVercelContextFromRepo(repo) throws if repo isn't configured.
  const gitRef = cfg?.defaultBranch;

  return {
    ...ctx,
    ...(gitRef ? { gitRef } : {}),
  };
}

function requirePreviewTarget(target?: VercelTarget): VercelTarget {
  // Default is preview; production is explicitly disabled.
  if (!target) return 'preview';
  if (target === 'preview') return 'preview';
  throw new Error('Production deploys are disabled (preview only)');
}

/**
 * JSON- tools  OpenAI (function calling).
 */
export const vercelToolsSchemas = [
  {
    type: 'function',
    function: {
      name: 'vercel_get_latest_deployments',
      description: '   Vercel (preview only).',
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
            description: '   (  5).',
          },
          repo: {
            type: 'string',
            description:
              'owner/name. If set  use Vercel project/team from config/repos.yml.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'vercel_get_deployment_status',
      description: '   Vercel  deployment_id.',
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
              'owner/name. If set  use Vercel team/project from config/repos.yml.',
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
              'Vercel projectId (override). If omitted  resolved from repo config/env.',
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
              'owner/name. If set  use Vercel project/team from config/repos.yml.',
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
              'owner/name. If set  use Vercel project/team from config/repos.yml.',
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
      description:
        'Diagnose Vercel deployment for a given git sha (preview only).',
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

/**
 * Tool handlers.
 */
export const vercelToolHandlers = {
  async vercel_get_latest_deployments(args: VercelGetLatestDeploymentsArgs) {
    const limit = args.limit ?? 5;
    const env: VercelTarget = requirePreviewTarget(args.target);

    const ctx = getVercelCtxFromRepo(args.repo);
    const data = await getLatestDeployments(env, ctx, limit);

    // backend/vercel.getLatestDeployments already returns normalized deployments
    const deployments = (Array.isArray(data) ? data : []).slice(0, limit);

    return {
      target: env,
      deployments,
    };
  },

  async vercel_get_deployment_status(args: VercelGetDeploymentStatusArgs) {
    const ctx = getVercelCtxFromRepo(args.repo);
    const raw = await getDeploymentStatus(args.deployment_id, ctx);
    return normalizeDeployment(raw as any);
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
    return normalizeDeployment(raw as any);
  },

  async vercel_redeploy(args: VercelRedeployArgs) {
    const target: VercelTarget = requirePreviewTarget(args.target);

    const ctx = getVercelCtxFromRepo(args.repo);
    const raw = await redeploy(args.deployment_id, target, ctx);
    return normalizeDeployment(raw as any);
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
