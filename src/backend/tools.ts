import type OpenAI from 'openai';

import { toolsHandlers, toolsSchemas } from './tools/index';

export function getToolsSchemas(): OpenAI.Responses.Tool[] {
  return [...toolsSchemas] as unknown as OpenAI.Responses.Tool[];
}

export async function handleToolCall(name: string, args: any) {
  const handler = (toolsHandlers as any)[name];
  if (!handler) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return handler(args);
}
