import {
  getLatestDeployments,
  getDeploymentStatus,
  triggerDeploy,
  redeploy,
} from '../vercel';

export type VercelTarget = 'production' | 'preview';

export interface VercelGetLatestDeploymentsArgs {
  target: VercelTarget;
  limit?: number;
}

export interface VercelGetDeploymentStatusArgs {
  deployment_id: string;
}

export interface VercelTriggerDeployArgs {
  project_id?: string;
  git_commit_sha?: string;
}

export interface VercelRedeployArgs {
  deployment_id: string;
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

  const projectId =
    typeof raw.projectId === 'string' ? raw.projectId : null;

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

/**
 * JSON-схемы tools для OpenAI (function calling).
 * Подключим их позже в общем списке tools ассистента.
 */
export const vercelToolsSchemas = [
  {
    type: 'function',
    function: {
      name: 'vercel_get_latest_deployments',
      description: 'Получить последние деплои на Vercel (production или preview).',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            enum: ['production', 'preview'],
            description: 'Целевая среда деплоя.',
          },
          limit: {
            type: 'number',
            description: 'Максимальное количество записей (по умолчанию 5).',
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
      description: 'Получить статус конкретного деплоя по deployment_id.',
      parameters: {
        type: 'object',
        properties: {
          deployment_id: {
            type: 'string',
            description: 'Идентификатор деплоя в Vercel.',
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
        'Запустить новый деплой проекта на Vercel (опционально привязать к git-коммиту).',
      parameters: {
        type: 'object',
        properties: {
          project_id: {
            type: 'string',
            description:
              'Идентификатор проекта Vercel. Если не указан, используется VERCEL_PROJECT_ID.',
          },
          git_commit_sha: {
            type: 'string',
            description:
              'SHA git-коммита, который нужно задеплоить (используется для github-линков).',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'vercel_redeploy',
      description: 'Пере-деплой готового деплоя по его deployment_id.',
      parameters: {
        type: 'object',
        properties: {
          deployment_id: {
            type: 'string',
            description: 'Идентификатор исходного деплоя в Vercel.',
          },
        },
        required: ['deployment_id'],
      },
    },
  },
] as const;

/**
 * Хендлеры tools — их будем дергать из общего router-а tools.
 */
export const vercelToolHandlers = {
  async vercel_get_latest_deployments(
    args: VercelGetLatestDeploymentsArgs,
  ) {
    const limit = args.limit ?? 5;
    const env: VercelTarget =
      args.target === 'preview' ? 'preview' : 'production';

    const data = await getLatestDeployments(env);

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

  async vercel_get_deployment_status(
    args: VercelGetDeploymentStatusArgs,
  ) {
    const raw = await getDeploymentStatus(args.deployment_id);
    return normalizeDeployment(raw as any);
  },

  async vercel_trigger_deploy(args: VercelTriggerDeployArgs) {
    const raw = await triggerDeploy(
      args.project_id,
      args.git_commit_sha,
    );
    return normalizeDeployment(raw as any);
  },

  async vercel_redeploy(args: VercelRedeployArgs) {
    const raw = await redeploy(args.deployment_id);
    return normalizeDeployment(raw as any);
  },
};
