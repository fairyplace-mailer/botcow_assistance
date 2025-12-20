import type OpenAI from 'openai';

import { toolsHandlers, toolsSchemas } from './tools/index';

export function getToolsSchemas(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  // We keep schemas in our internal format but they are compatible with the OpenAI SDK type.
  return toolsSchemas as unknown as OpenAI.Chat.Completions.ChatCompletionTool[];
}

export async function handleToolCall(name: string, args: any) {
  const handler = (toolsHandlers as any)[name];
  if (!handler) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return handler(args);
}
