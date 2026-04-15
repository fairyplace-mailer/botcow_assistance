import type OpenAI from 'openai';

import {
  hashToolArgs,
  makeToolFingerprint,
  normalizeStrictToolArgs,
  safeParseToolArgs,
  validateToolArgsAgainstSchema,
} from '../guards/toolArgs';
import { runToolWithTimeout } from '../guards/toolExecution';

export type PreparedToolCallFailureCode =
  | 'unknown_tool'
  | 'invalid_tool_args_json'
  | 'invalid_tool_args_schema';

export type PreparedToolCall =
  | {
      ok: true;
      normalizedArgs: Record<string, unknown>;
      argsHash: string;
      fingerprint: string;
    }
  | {
      ok: false;
      code: PreparedToolCallFailureCode;
      argsParseOk?: boolean;
      schemaValid?: boolean;
      argsHash?: string;
    };

function getToolDefinition(name: string, tools: OpenAI.Responses.Tool[] | undefined) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;

  return tools.find((tool: any) => tool?.type === 'function' && tool?.name === name) as
    | OpenAI.Responses.FunctionTool
    | undefined;
}

export function prepareToolCall(
  call: { name: string; arguments: unknown },
  tools: OpenAI.Responses.Tool[] | undefined,
): PreparedToolCall {
  const tool = getToolDefinition(call.name, tools);
  if (!tool) {
    return { ok: false, code: 'unknown_tool' };
  }

  const rawArgs =
    typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments ?? {});
  const parsed = safeParseToolArgs(rawArgs);
  if (!parsed.ok) {
    return {
      ok: false,
      code: 'invalid_tool_args_json',
      argsParseOk: false,
    };
  }

  const schemaValidation = validateToolArgsAgainstSchema(
    (tool.parameters as Record<string, unknown> | null | undefined) ?? null,
    parsed.value,
  );

  const normalizedArgs =
    (normalizeStrictToolArgs(parsed.value) as Record<string, unknown> | undefined) ?? {};
  const argsHash = hashToolArgs(normalizedArgs);

  if (!schemaValidation.ok) {
    return {
      ok: false,
      code: 'invalid_tool_args_schema',
      argsParseOk: true,
      schemaValid: false,
      argsHash,
    };
  }

  return {
    ok: true,
    normalizedArgs,
    argsHash,
    fingerprint: makeToolFingerprint(call.name, normalizedArgs),
  };
}

export async function executePreparedToolCall(params: {
  name: string;
  normalizedArgs: Record<string, unknown>;
  timeoutMs: number;
  execute: (name: string, args: unknown) => Promise<unknown>;
}): Promise<
  | { ok: true; output: unknown; toolLatencyMs: number }
  | { ok: false; code: 'tool_timeout' | 'tool_execution_failed'; error?: string; toolLatencyMs: number }
> {
  const startedToolAt = Date.now();

  const result = await runToolWithTimeout({
    name: params.name,
    args: params.normalizedArgs,
    timeoutMs: params.timeoutMs,
    execute: params.execute,
  });

  const toolLatencyMs = Date.now() - startedToolAt;

  if (result.ok === false) {
    return {
      ok: false,
      code: result.code,
      error: result.error,
      toolLatencyMs,
    };
  }

  return {
    ok: true,
    output: result.output,
    toolLatencyMs,
  };
}
