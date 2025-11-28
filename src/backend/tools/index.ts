import { githubToolsSchemas, githubToolHandlers } from './githubTools';
import { vercelToolsSchemas, vercelToolHandlers } from './vercelTools';

export const toolSchemas = [
  ...githubToolsSchemas,
  ...vercelToolsSchemas,
] as const;

export const toolHandlers = {
  ...githubToolHandlers,
  ...vercelToolHandlers,
};

export type ToolName = keyof typeof toolHandlers;
