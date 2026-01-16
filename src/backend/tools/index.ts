import { githubToolHandlers, githubToolsSchemas } from './githubTools';
import { vercelToolHandlers, vercelToolsSchemas } from './vercelTools';
import { deploymentToolHandlers, deploymentToolsSchemas } from './deploymentTools';
import {
  repo_register,
  repoRegistrationToolSchema,
} from './repoRegistrationTools';
import { wixDocsToolHandlers, wixDocsToolsSchemas } from './wixDocsTools';

export const toolsSchemas = [
  ...githubToolsSchemas,
  ...vercelToolsSchemas,
  ...deploymentToolsSchemas,
  ...wixDocsToolsSchemas,
  repoRegistrationToolSchema,
] as const;

export const toolsHandlers = {
  ...githubToolHandlers,
  ...vercelToolHandlers,
  ...deploymentToolHandlers,
  ...wixDocsToolHandlers,
  repo_register,
} as const;
