import { githubToolHandlers, githubToolsSchemas } from './githubTools';
import { vercelToolHandlers, vercelToolsSchemas } from './vercelTools';
import { deploymentToolHandlers, deploymentToolsSchemas } from './deploymentTools';
import {
  repo_register,
  repoRegistrationToolSchema,
} from './repoRegistrationTools';

export const toolsSchemas = [
  ...githubToolsSchemas,
  ...vercelToolsSchemas,
  ...deploymentToolsSchemas,
  repoRegistrationToolSchema,
] as const;

export const toolsHandlers = {
  ...githubToolHandlers,
  ...vercelToolHandlers,
  ...deploymentToolHandlers,
  repo_register,
} as const;
