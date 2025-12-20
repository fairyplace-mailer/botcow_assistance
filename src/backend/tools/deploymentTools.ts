import {
  getLatestDeployments,
  getDeploymentStatus,
  type VercelTarget,
} from '../vercel';
import { commentOnPullRequest } from '../github';
import {
  normalizeVercelDeployment,
  type NormalizedVercelDeployment,
} from '../vercelNormalize';

export interface DeploymentWaitForPreviewArgs {
  pull_number: number;
  git_commit_sha: string;
  target?: VercelTarget;
  repo?: string;
  timeout_seconds?: number;
  poll_interval_seconds?: number;
}

interface DeploymentWaitForPreviewResult {
  status: 'success' | 'failed' | 'timeout';
  deployment: NormalizedVercelDeployment | null;
  comment?: {
    id?: number | string;
    url?: string | null;
    html_url?: string | null;
  } | null;
  error?: string;
}

function normalizeDeployment(raw: any): NormalizedVercelDeployment {
  return normalizeVercelDeployment(raw);
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function matchesGitSha(raw: any, gitSha: string): boolean {
  if (!raw || !gitSha) return false;
  const needle = gitSha.toLowerCase();

  if (raw.gitSource && typeof raw.gitSource === 'object') {
    const sha = (raw.gitSource as any).sha;
    if (typeof sha === 'string' && sha.toLowerCase() === needle) {
      return true;
    }
  }

  if (raw.meta && typeof raw.meta === 'object') {
    const meta = raw.meta as Record<string, unknown>;
    for (const [key, value] of Object.entries(meta)) {
      if (typeof value === 'string' && value.toLowerCase() === needle) {
        return true;
      }

      if (
        typeof value === 'string' &&
        ['githubCommitSha', 'gitCommitSha', 'commitSha', 'commit'].includes(key) &&
        value.toLowerCase() === needle
      ) {
        return true;
      }
    }
  }

  return false;
}

export const deploymentToolsSchemas = [
  {
    type: 'function',
    function: {
      name: 'deployment_wait_for_preview_and_comment_pr',
      description:
        'Подождать Vercel preview/production деплой для указанного git commit SHA и оставить комментарий в Pull Request с ссылкой и статусом.',
      parameters: {
        type: 'object',
        properties: {
          pull_number: {
            type: 'number',
            description: 'Номер Pull Request в GitHub.',
          },
          git_commit_sha: {
            type: 'string',
            description:
              'SHA git-коммита, для которого нужно найти Vercel деплой.',
          },
          target: {
            type: 'string',
            enum: ['production', 'preview'],
            description:
              'Целевая среда деплоя. По умолчанию preview.',
          },
          repo: {
            type: 'string',
            description:
              'Репозиторий owner/repo, по умолчанию BOTCOW_DEFAULT_REPO.',
          },
          timeout_seconds: {
            type: 'number',
            description:
              'Максимальное время ожидания деплоя в секундах (по умолчанию 600).',
          },
          poll_interval_seconds: {
            type: 'number',
            description:
              'Интервал между проверками в секундах (по умолчанию 15).',
          },
        },
        required: ['pull_number', 'git_commit_sha'],
      },
    },
  },
] as const;

export const deploymentToolHandlers = {
  async deployment_wait_for_preview_and_comment_pr(
    args: DeploymentWaitForPreviewArgs,
  ): Promise<DeploymentWaitForPreviewResult> {
    const pullNumber = args.pull_number;
    const gitSha = args.git_commit_sha;
    const target: VercelTarget = args.target === 'production' ? 'production' : 'preview';

    const timeoutMs = (args.timeout_seconds ?? 600) * 1000;
    const intervalMs = (args.poll_interval_seconds ?? 15) * 1000;
    const deadline = Date.now() + timeoutMs;

    let lastDeployment: NormalizedVercelDeployment | null = null;
    let lastError: string | undefined;

    while (Date.now() < deadline) {
      try {
        const data = await getLatestDeployments(target);
        const rawDeployments = Array.isArray((data as any).deployments)
          ? (data as any).deployments
          : [];

        const foundRaw = rawDeployments.find((d: any) => matchesGitSha(d, gitSha));

        if (foundRaw) {
          const idOrUid =
            (typeof foundRaw.id === 'string' && foundRaw.id) ||
            (typeof foundRaw.uid === 'string' && foundRaw.uid) ||
            '';

          const detailed = idOrUid ? await getDeploymentStatus(idOrUid) : foundRaw;

          const normalized = normalizeDeployment(detailed);
          lastDeployment = normalized;

          const stateRaw = (normalized.readyState || normalized.state || '').toLowerCase();

          if (stateRaw === 'ready' || stateRaw === 'completed' || stateRaw === 'success') {
            const url = normalized.url ? `https://${normalized.url}` : null;

            const envLabel = normalized.target || target;

            const lines = [
              `Vercel ${envLabel} deployment is ready.`,
              '',
              url ? `- URL: ${url}` : '- URL: (not available)',
              `- Status: ${normalized.readyState ?? normalized.state ?? 'unknown'}`,
              `- Commit: \`${gitSha}\``,
            ];

            const body = lines.join('\n');

            const commentOptions: {
              pull_number: number;
              body: string;
              repo?: string;
            } = {
              pull_number: pullNumber,
              body,
            };

            if (args.repo) {
              commentOptions.repo = args.repo;
            }

            const comment = await commentOnPullRequest(commentOptions);

            return {
              status: 'success',
              deployment: normalized,
              comment: {
                id: (comment as any).id,
                url: (comment as any).url ?? null,
                html_url: (comment as any).html_url ?? null,
              },
            };
          }

          if (
            stateRaw === 'error' ||
            stateRaw === 'failed' ||
            stateRaw === 'canceled' ||
            stateRaw === 'cancelled'
          ) {
            return {
              status: 'failed',
              deployment: normalized,
              comment: null,
              error: `Deployment reached terminal error state: ${stateRaw}`,
            };
          }
        }

        lastError = undefined;
      } catch (e: any) {
        lastError = e?.message || String(e);
      }

      await delay(intervalMs);
    }

    return {
      status: 'timeout',
      deployment: lastDeployment,
      comment: null,
      error: lastError ?? 'Timed out waiting for deployment to become ready or fail.',
    };
  },
};
