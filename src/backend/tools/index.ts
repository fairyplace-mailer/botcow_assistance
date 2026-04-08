import * as githubTools from './githubTools';
import { vercelToolHandlers, vercelToolsSchemas } from './vercelTools';
import * as deploymentTools from './deploymentTools';
import * as previewTools from './previewTools';
import {
  repo_register,
  repoRegistrationToolSchema,
} from './repoRegistrationTools';

export const toolsSchemas = [
  ...githubTools.githubToolsSchemas,
  ...vercelToolsSchemas,
  ...deploymentTools.deploymentToolsSchemas,
  ...previewTools.previewToolsSchemas,
  repoRegistrationToolSchema,
] as const;

export const toolsHandlers = {
  ...githubTools.githubToolHandlers,
  ...vercelToolHandlers,
  ...deploymentTools.deploymentToolHandlers,
  ...previewTools.previewToolHandlers,
  repo_register,
} as const;
