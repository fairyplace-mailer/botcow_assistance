import type OpenAI from 'openai';
import { assertToolAllowed, filterToolsForMode, type ToolPolicyMode } from './guards/toolPolicy';
import { toolsHandlers, toolsSchemas } from './tools/index';

export const toolSchemas = toolsSchemas;
export const toolHandlers = toolsHandlers;
export type ToolName = keyof typeof toolHandlers;

function normalizeResponsesTool(tool: any): OpenAI.Responses.Tool {
  if (tool?.type === 'function' && tool?.function?.name) {
    return {
      type: 'function',
      name: tool.function.name,
      ...(tool.function.description ? { description: tool.function.description } : {}),
      ...(tool.function.parameters ? { parameters: tool.function.parameters } : {}),
      ...(tool.function.strict !== undefined ? { strict: tool.function.strict } : {}),
    } as OpenAI.Responses.Tool;
  }

  return tool as OpenAI.Responses.Tool;
}

export function getToolsSchemas(mode: ToolPolicyMode = 'default'): OpenAI.Responses.Tool[] {
  return filterToolsForMode(toolsSchemas.map(normalizeResponsesTool), mode);
}

export async function handleToolCall(
  name: string,
  args: any,
  mode: ToolPolicyMode = 'default',
) {
  assertToolAllowed(name, mode);

  const handler = (toolsHandlers as any)[name];
  if (!handler) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return handler(args);
}
