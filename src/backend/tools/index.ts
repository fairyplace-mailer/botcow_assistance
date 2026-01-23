import { githubToolHandlers, githubToolsSchemas } from './githubTools';
import { vercelToolHandlers, vercelToolsSchemas } from './vercelTools';
import { deploymentToolHandlers, deploymentToolsSchemas } from './deploymentTools';
import { previewToolHandlers, previewToolsSchemas } from './previewTools';
import {
  repo_register,
  repoRegistrationToolSchema,
} from './repoRegistrationTools';

export const toolsSchemas = [
  ...githubToolsSchemas,
  ...vercelToolsSchemas,
  ...deploymentToolsSchemas,
  ...previewToolsSchemas,
  repoRegistrationToolSchema,
] as const;

export const toolsHandlers = {
  ...githubToolHandlers,
  ...vercelToolHandlers,
  ...deploymentToolHandlers,
  ...previewToolHandlers,
  repo_register,
} as const;
