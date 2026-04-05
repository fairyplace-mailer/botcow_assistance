import * as githubTools from './githubTools';
import { vercelToolHandlers, vercelToolsSchemas } from './vercelTools';
import * as deploymentTools from './deploymentTools';
import * as previewTools from './previewTools';
import {
  repo_register,
  repoRegistrationToolSchema,
} from './repoRegistrationTools';

const resolvedGithubToolsSchemas = (
  githubTools.githubToolsSchemas ??
  [githubTools.githubSearchInRepoSchema].filter(Boolean)
) as readonly unknown[];

const resolvedGithubToolHandlers = (
  githubTools.githubToolHandlers ??
  (githubTools.githubSearchInRepoTool
    ? { githubSearchInRepo: githubTools.githubSearchInRepoTool }
    : {})
) as Record<string, unknown>;

const resolvedDeploymentToolsSchemas = (
  deploymentTools.deploymentToolsSchemas ??
  [deploymentTools.deploymentWaitForPreviewAndCommentPrSchema].filter(Boolean)
) as readonly unknown[];

const resolvedDeploymentToolHandlers = (
  deploymentTools.deploymentToolHandlers ??
  (deploymentTools.deploymentWaitForPreviewAndCommentPrTool
    ? {
        deployment_wait_for_preview_and_comment_pr:
          deploymentTools.deploymentWaitForPreviewAndCommentPrTool,
      }
    : {})
) as Record<string, unknown>;

const resolvedPreviewToolsSchemas = (
  previewTools.previewToolsSchemas ??
  [
    previewTools.previewGetUrlSchema,
    previewTools.previewHttpRequestSchema,
    previewTools.previewSmokeCheckSchema,
  ].filter(Boolean)
) as readonly unknown[];

const resolvedPreviewToolHandlers = (
  previewTools.previewToolHandlers ??
  {
    ...(previewTools.previewGetUrlTool
      ? { preview_get_url: previewTools.previewGetUrlTool }
      : {}),
    ...(previewTools.previewHttpRequestTool
      ? { preview_http_request: previewTools.previewHttpRequestTool }
      : {}),
    ...(previewTools.previewSmokeCheckTool
      ? { preview_smoke_check: previewTools.previewSmokeCheckTool }
      : {}),
  }
) as Record<string, unknown>;

export const toolsSchemas = [
  ...resolvedGithubToolsSchemas,
  ...vercelToolsSchemas,
  ...resolvedDeploymentToolsSchemas,
  ...resolvedPreviewToolsSchemas,
  repoRegistrationToolSchema,
] as const;

export const toolsHandlers = {
  ...resolvedGithubToolHandlers,
  ...vercelToolHandlers,
  ...resolvedDeploymentToolHandlers,
  ...resolvedPreviewToolHandlers,
  repo_register,
} as const;
