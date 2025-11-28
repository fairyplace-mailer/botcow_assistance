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
  async vercel_get_latest_deployments(args: VercelGetLatestDeploymentsArgs) {
    const limit = args.limit ?? 5;
    const env =
      args.target === 'preview'
        ? ('preview' as const)
        : ('production' as const);

    const data = await getLatestDeployments(env);
    if (Array.isArray((data as any).deployments)) {
      (data as any).deployments = (data as any).deployments.slice(0, limit);
    }
    return data;
  },

  async vercel_get_deployment_status(args: VercelGetDeploymentStatusArgs) {
    return getDeploymentStatus(args.deployment_id);
  },

  async vercel_trigger_deploy(args: VercelTriggerDeployArgs) {
    return triggerDeploy(args.project_id, args.git_commit_sha);
  },

  async vercel_redeploy(args: VercelRedeployArgs) {
    return redeploy(args.deployment_id);
  },
};
