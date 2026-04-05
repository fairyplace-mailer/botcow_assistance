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
  [
    deploymentTools.getPreviewUrlSchema,
    deploymentTools.previewHttpRequestSchema,
    deploymentTools.previewSmokeCheckSchema,
  ].filter(Boolean);

const resolvedDeploymentToolHandlers =
  deploymentTools.deploymentToolHandlers ??
  ({
    get_preview_url: deploymentTools.getPreviewUrlTool,
    preview_http_request: deploymentTools.previewHttpRequestTool,
    preview_smoke_check: deploymentTools.previewSmokeCheckTool,
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
