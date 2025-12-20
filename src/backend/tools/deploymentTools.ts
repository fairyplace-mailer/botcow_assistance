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
  /** preview only; kept for backward compatibility, but production is rejected */
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

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function requirePreviewTarget(target?: VercelTarget): VercelTarget {
  // Default is preview; production is explicitly disabled per spec.
  if (!target) return 'preview';
  if (target === 'preview') return 'preview';
  throw new Error('Production deploys are disabled (preview only)');
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
        'Wait for a Vercel preview deployment for the given git commit SHA and comment on the Pull Request with the URL and status (preview only).',
      parameters: {
        type: 'object',
        properties: {
          pull_number: {
            type: 'number',
            description: 'Pull Request number in GitHub.',
          },
          git_commit_sha: {
            type: 'string',
            description:
              'SHA of the git commit for which we should find the Vercel deployment.',
          },
          target: {
            type: 'string',
            enum: ['preview'],
            description: 'Target environment. Only preview is allowed.',
          },
          repo: {
            type: 'string',
            description:
              'Repository owner/repo (optional; defaults to BOTCOW_DEFAULT_REPO).',
          },
          timeout_seconds: {
            type: 'number',
            description:
              'Maximum waiting time in seconds (default 600).',
          },
          poll_interval_seconds: {
            type: 'number',
            description:
              'Polling interval in seconds (default 15).',
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
    const target: VercelTarget = requirePreviewTarget(args.target);

    const timeoutMs = (args.timeout_seconds ?? 600) * 1000;
    const intervalMs = (args.poll_interval_seconds ?? 15) * 1000;
    const deadline = Date.now() + timeoutMs;

    let lastDeployment: NormalizedVercelDeployment | null = null;
    let lastError: string | undefined;

    while (Date.now() < deadline) {
      try {
        const deployments = await getLatestDeployments(target);

        // For matching by git SHA we need raw-ish meta/gitSource fields.
        // `getLatestDeployments` returns normalized deployments, so we match against normalized meta only.
        const found = deployments.find((d: any) => matchesGitSha(d, gitSha));

        if (found) {
          const detailed = found.id ? await getDeploymentStatus(found.id) : found;

          const normalized = normalizeVercelDeployment(detailed as any);
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
