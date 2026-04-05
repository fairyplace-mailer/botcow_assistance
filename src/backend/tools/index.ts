import * as githubTools from './githubTools';
import { vercelToolHandlers, vercelToolsSchemas } from './vercelTools';
import { deploymentToolHandlers, deploymentToolsSchemas } from './deploymentTools';
import { previewToolHandlers, previewToolsSchemas } from './previewTools';
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

export const toolsSchemas = [
  ...resolvedGithubToolsSchemas,
  ...vercelToolsSchemas,
  ...deploymentToolsSchemas,
  ...previewToolsSchemas,
  repoRegistrationToolSchema,
] as const;

export const toolsHandlers = {
  ...resolvedGithubToolHandlers,
  ...vercelToolHandlers,
  ...deploymentToolHandlers,
  ...previewToolHandlers,
  repo_register,
} as const;
