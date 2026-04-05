import * as githubTools from './githubTools';
import { vercelToolHandlers, vercelToolsSchemas } from './vercelTools';
import * as deploymentTools from './deploymentTools';
import * as previewTools from './previewTools';
import {
  repo_register,
  repoRegistrationToolSchema,
} from './repoRegistrationTools';

const resolvedGithubToolsSchemas =
  githubTools.githubToolsSchemas ??
  [githubTools.githubSearchInRepoSchema].filter(Boolean);

const resolvedGithubToolHandlers =
  githubTools.githubToolHandlers ??
  ({
    github_search_in_repo: githubTools.githubSearchInRepoTool,
  } as const);

const resolvedDeploymentToolsSchemas =
  deploymentTools.deploymentToolsSchemas ??
  [deploymentTools.deploymentWaitForPreviewAndCommentPrSchema].filter(Boolean);

const resolvedDeploymentToolHandlers =
  deploymentTools.deploymentToolHandlers ??
  ({
    deployment_wait_for_preview_and_comment_pr:
      deploymentTools.deploymentWaitForPreviewAndCommentPrTool,
  } as const);

const resolvedPreviewToolsSchemas =
  previewTools.previewToolsSchemas ??
  [
    previewTools.previewGetUrlSchema,
    previewTools.previewHttpRequestSchema,
    previewTools.previewSmokeCheckSchema,
  ].filter(Boolean);

const resolvedPreviewToolHandlers =
  previewTools.previewToolHandlers ??
  ({
    preview_get_url: previewTools.previewGetUrlTool,
    preview_http_request: previewTools.previewHttpRequestTool,
    preview_smoke_check: previewTools.previewSmokeCheckTool,
  } as const);

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
