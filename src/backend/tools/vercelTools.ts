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

export interface VercelGetLatestDeploymentsArgs {
  target: VercelTarget;
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

export interface NormalizedVercelDeployment {
  id: string;
  url: string | null;
  state: string | null;
  readyState: string | null;
  createdAt: number | null;
  target: string | null;
  name: string | null;
  projectId: string | null;
  inspectorUrl: string | null;
  meta: Record<string, unknown> | null;
}

function normalizeDeployment(raw: any): NormalizedVercelDeployment {
  if (!raw || typeof raw !== 'object') {
    return {
      id: '',
      url: null,
      state: null,
      readyState: null,
      createdAt: null,
      target: null,
      name: null,
      projectId: null,
      inspectorUrl: null,
      meta: null,
    };
  }

  const id =
    (typeof raw.id === 'string' && raw.id) ||
    (typeof raw.uid === 'string' && raw.uid) ||
    '';

  const url = typeof raw.url === 'string' ? raw.url : null;

  const createdAt =
    (typeof raw.createdAt === 'number' && raw.createdAt) ||
    (typeof raw.created === 'number' && raw.created) ||
    null;

  const state =
    (typeof raw.state === 'string' && raw.state) ||
    (typeof raw.status === 'string' && raw.status) ||
    null;

  const readyState =
    (typeof raw.readyState === 'string' && raw.readyState) || state;

  const target = typeof raw.target === 'string' ? raw.target : null;

  const name = typeof raw.name === 'string' ? raw.name : null;

  const projectId = typeof raw.projectId === 'string' ? raw.projectId : null;

  const inspectorUrl =
    typeof raw.inspectorUrl === 'string' ? raw.inspectorUrl : null;

  const meta =
    raw.meta && typeof raw.meta === 'object'
      ? (raw.meta as Record<string, unknown>)
      : null;

  return {
    id,
    url,
    state,
    readyState,
    createdAt,
    target,
    name,
    projectId,
    inspectorUrl,
    meta,
  };
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

/**
 * JSON- tools  OpenAI (function calling).
 */
export const vercelToolsSchemas = [
  {
    type: 'function',
    function: {
      name: 'vercel_get_latest_deployments',
      description: ' Vercel (production  preview).',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            enum: ['production', 'preview'],
            description: '.',
          },
          limit: {
            type: 'number',
            description: '  (  5).',
          },
          repo: {
            type: 'string',
            description:
              'owner/name.    Vercel project/team  config/repos.yml.',
          },
        },
        required: ['target'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'vercel_get_deployment_status',
      description: '  Vercel  deployment_id.',
      parameters: {
        type: 'object',
        properties: {
          deployment_id: {
            type: 'string',
            description: 'ID  Vercel.',
          },
          repo: {
            type: 'string',
            description:
              'owner/name.    Vercel team/project  config/repos.yml.',
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
        '   Vercel (  git sha  project_id).',
      parameters: {
        type: 'object',
        properties: {
          project_id: {
            type: 'string',
            description:
              'Vercel projectId (override).      repo config/env.',
          },
          git_commit_sha: {
            type: 'string',
            description: 'Git commit SHA ( /).',
          },
          target: {
            type: 'string',
            enum: ['production', 'preview'],
            description: ' (  production).',
          },
          repo: {
            type: 'string',
            description:
              'owner/name.    Vercel project/team  config/repos.yml.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'vercel_redeploy',
      description: '   Vercel  deployment_id.',
      parameters: {
        type: 'object',
        properties: {
          deployment_id: {
            type: 'string',
            description: 'ID  Vercel.',
          },
          target: {
            type: 'string',
            enum: ['production', 'preview'],
            description: ' (  production).',
          },
          repo: {
            type: 'string',
            description:
              'owner/name.    Vercel project/team  config/repos.yml.',
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
        'Diagnose Vercel deployment for a given git sha. Guarantees returning inspector/logs URL when available. Uses documented fallback: branch + time window.',
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
            enum: ['production', 'preview'],
            description: 'Deployment target environment.',
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
 *  tools.
 */
export const vercelToolHandlers = {
  async vercel_get_latest_deployments(args: VercelGetLatestDeploymentsArgs) {
    const limit = args.limit ?? 5;
    const env: VercelTarget =
      args.target === 'preview' ? 'preview' : 'production';

    const ctx = getVercelCtxFromRepo(args.repo);
    const data = await getLatestDeployments(env, ctx, limit);

    const deploymentsRaw = Array.isArray((data as any).deployments)
      ? (data as any).deployments
      : [];

    const deployments = deploymentsRaw
      .slice(0, limit)
      .map((d: any) => normalizeDeployment(d));

    const pagination =
      (data as any).pagination && typeof (data as any).pagination === 'object'
        ? (data as any).pagination
        : undefined;

    return {
      target: env,
      deployments,
      ...(pagination ? { pagination } : {}),
    };
  },

  async vercel_get_deployment_status(args: VercelGetDeploymentStatusArgs) {
    const ctx = getVercelCtxFromRepo(args.repo);
    const raw = await getDeploymentStatus(args.deployment_id, ctx);
    return normalizeDeployment(raw as any);
  },

  async vercel_trigger_deploy(args: VercelTriggerDeployArgs) {
    const target: VercelTarget =
      args.target === 'preview' ? 'preview' : 'production';

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
    const target: VercelTarget =
      args.target === 'preview' ? 'preview' : 'production';

    const ctx = getVercelCtxFromRepo(args.repo);
    const raw = await redeploy(args.deployment_id, target, ctx);
    return normalizeDeployment(raw as any);
  },

  async vercel_diagnose_deployment(args: VercelDiagnoseDeploymentArgs) {
    return diagnoseVercelDeployment({
      ...(args.repo ? { repo: args.repo } : {}),
      ...(args.git_sha ? { git_sha: args.git_sha } : {}),
      ...(args.branch ? { branch: args.branch } : {}),
      ...(args.target ? { target: args.target } : {}),
      ...(args.timeWindowMinutes !== undefined
        ? { timeWindowMinutes: args.timeWindowMinutes }
        : {}),
    });
  },
};
