import type OpenAI from 'openai';
import { toolsHandlers, toolsSchemas } from './tools/index';

export const toolSchemas = toolsSchemas;
export const toolHandlers = toolsHandlers;
export type ToolName = keyof typeof toolHandlers;

export function getToolsSchemas(): OpenAI.Responses.Tool[] {
  return toolsSchemas.map((tool: any) => {
    const t = tool?.function ? tool.function : tool;

    return {
      type: 'function',
      name: t.name,
      description: t.description ?? '',
      parameters: t.parameters ?? {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
      strict: t.strict ?? false,
    } as OpenAI.Responses.Tool;
  });
}

export async function handleToolCall(name: string, args: any) {
  const handler = (toolsHandlers as any)[name];
  if (!handler) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return handler(args);
}
