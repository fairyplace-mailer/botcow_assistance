export type ToolExecutionFailureCode = 'tool_timeout' | 'tool_execution_failed';

export async function runToolWithTimeout(params: {
  name: string;
  args: unknown;
  timeoutMs: number;
  execute: (name: string, args: unknown) => Promise<unknown>;
}): Promise<
  | { ok: true; output: unknown }
  | { ok: false; code: ToolExecutionFailureCode; error?: string }
> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = await Promise.race([
      params.execute(params.name, params.args),
      new Promise<never>((_, reject) => {
        const error = new Error(`Tool timed out after ${params.timeoutMs}ms`);
        error.name = 'TimeoutError';
        timeoutId = setTimeout(() => reject(error), params.timeoutMs);
      }),
    ]);

    return { ok: true, output: result };
  } catch (error: any) {
    if (error?.name === 'TimeoutError') {
      return { ok: false, code: 'tool_timeout', error: error.message };
    }

    return {
      ok: false,
      code: 'tool_execution_failed',
      error: error?.message ? String(error.message) : String(error),
    };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
