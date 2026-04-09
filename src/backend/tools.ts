import type OpenAI from 'openai';
import { toolsHandlers, toolsSchemas } from './tools/index';

export const toolSchemas = toolsSchemas;
export const toolHandlers = toolsHandlers;
export type ToolName = keyof typeof toolHandlers;

function cleanText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

function cleanJsonSchema(node: any): any {
  if (Array.isArray(node)) {
    return node.map(cleanJsonSchema);
  }

  if (!node || typeof node !== 'object') {
    return node;
  }

  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(node)) {
    if (key === 'description') {
      out[key] = cleanText(value);
      continue;
    }

    out[key] = cleanJsonSchema(value);
  }

  return out;
}

export function getToolsSchemas(): OpenAI.Responses.Tool[] {
  return toolsSchemas.map((tool: any) => {
    const fn = tool?.function ?? tool;

    return {
      type: 'function',
      name: fn.name,
      description: cleanText(fn.description),
      parameters: cleanJsonSchema(
        fn.parameters ?? {
          type: 'object',
          properties: {},
          required: [],
          additionalProperties: false,
        },
      ),
      strict: fn.strict ?? false,
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
