import { toolSchemas, toolHandlers, type ToolName } from '../src/backend/tools';

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

describe('tools export contract', () => {
  test('every tool schema has a handler and handler is a function', () => {
    const names = toolSchemas
      .map((s: any) => s?.function?.name)
      .filter(isNonEmptyString);

    // basic sanity: we expect some tools
    expect(names.length).toBeGreaterThan(0);

    const missing: string[] = [];
    const nonFn: string[] = [];

    for (const name of names) {
      const handler = (toolHandlers as any)[name as ToolName];
      if (!handler) missing.push(name);
      else if (typeof handler !== 'function') nonFn.push(name);
    }

    expect(missing).toEqual([]);
    expect(nonFn).toEqual([]);
  });

  test('handlers should not expose extra tool names not present in schemas', () => {
    const schemaNames = new Set(
      toolSchemas
        .map((s: any) => s?.function?.name)
        .filter(isNonEmptyString),
    );

    const handlerNames = Object.keys(toolHandlers);

    const extra = handlerNames.filter((n) => !schemaNames.has(n));

    // Allow internal helpers if any; currently we want exact match.
    expect(extra).toEqual([]);
  });
});
