import { githubToolsSchemas, githubToolHandlers } from './githubTools';
import { vercelToolsSchemas, vercelToolHandlers } from './vercelTools';
import {
  deploymentToolsSchemas,
  deploymentToolHandlers,
} from './deploymentTools';

export const toolSchemas = [
  ...githubToolsSchemas,
  ...vercelToolsSchemas,
  ...deploymentToolsSchemas,
] as const;

export const toolHandlers = {
  ...githubToolHandlers,
  ...vercelToolHandlers,
  ...deploymentToolHandlers,
};

export type ToolName = keyof typeof toolHandlers;
