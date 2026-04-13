import { createHash } from 'crypto';

function jsonSchemaTypeOf(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashToolArgs(args: unknown): string {
  return sha256(stableStringify(args));
}

export function makeToolFingerprint(toolName: string, args: unknown): string {
  return sha256(`${toolName}\n${stableStringify(args)}`);
}

export function safeParseToolArgs(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

export function normalizeStrictToolArgs(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;

  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeStrictToolArgs(item))
      .filter((item) => item !== undefined);
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const normalized = normalizeStrictToolArgs(item);
      if (normalized !== undefined) out[key] = normalized;
    }
    return out;
  }

  return value;
}

export function validateToolArgsAgainstSchema(
  schema: Record<string, unknown> | null | undefined,
  value: unknown,
): { ok: true } | { ok: false; issues: string[] } {
  if (!schema || typeof schema !== 'object') return { ok: true };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, issues: ['arguments must be an object'] };
  }

  const objectValue = value as Record<string, unknown>;
  const properties =
    schema.properties && typeof schema.properties === 'object'
      ? (schema.properties as Record<string, Record<string, unknown>>)
      : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === 'string')
    : [];
  const additionalProperties = schema.additionalProperties;
  const issues: string[] = [];

  for (const key of required) {
    if (!(key in objectValue)) issues.push(`missing required field: ${key}`);
  }

  for (const [key, item] of Object.entries(objectValue)) {
    const propSchema = properties[key];
    if (!propSchema) {
      if (additionalProperties === false) issues.push(`unexpected field: ${key}`);
      continue;
    }

    const expectedType = propSchema.type;
    if (typeof expectedType === 'string') {
      const actualType = jsonSchemaTypeOf(item);
      if (expectedType !== actualType) issues.push(`field ${key} must be ${expectedType}`);
      continue;
    }

    if (Array.isArray(expectedType) && expectedType.every((t): t is string => typeof t === 'string')) {
      const actualType = jsonSchemaTypeOf(item);
      if (!expectedType.includes(actualType)) {
        issues.push(`field ${key} must be one of: ${expectedType.join(', ')}`);
      }
    }
  }

  return issues.length ? { ok: false, issues } : { ok: true };
}
