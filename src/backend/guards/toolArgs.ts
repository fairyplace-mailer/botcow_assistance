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

function valuesEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function allowedTypesFromSchema(schema: Record<string, unknown>): string[] {
  const typeValue = schema.type;

  if (typeof typeValue === 'string') return [typeValue];
  if (Array.isArray(typeValue)) {
    return typeValue.filter((item): item is string => typeof item === 'string');
  }

  return [];
}

function matchesAllowedType(value: unknown, allowedTypes: string[]): boolean {
  if (allowedTypes.length === 0) return true;

  const actualType = jsonSchemaTypeOf(value);
  return allowedTypes.some((type) => {
    if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
    return type === actualType;
  });
}

function formatPath(path: string, segment: string | number): string {
  if (typeof segment === 'number') return `${path}[${segment}]`;
  return path === '$' ? `$.${segment}` : `${path}.${segment}`;
}

function validateValueAgainstSchema(
  schema: Record<string, unknown> | null | undefined,
  value: unknown,
  path: string,
  issues: string[],
): void {
  if (!schema || typeof schema !== 'object') return;

  const allowedTypes = allowedTypesFromSchema(schema);
  if (!matchesAllowedType(value, allowedTypes)) {
    issues.push(
      `${path} must be ${allowedTypes.join(' | ') || 'a valid schema type'}, got ${jsonSchemaTypeOf(value)}`,
    );
    return;
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => valuesEqual(candidate, value))) {
    issues.push(`${path} must be one of: ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}`);
    return;
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      issues.push(`${path} must have length >= ${schema.minLength}`);
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      issues.push(`${path} must have length <= ${schema.maxLength}`);
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      issues.push(`${path} must be >= ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      issues.push(`${path} must be <= ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      issues.push(`${path} must contain at least ${schema.minItems} items`);
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      issues.push(`${path} must contain at most ${schema.maxItems} items`);
    }

    const itemSchema =
      schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)
        ? (schema.items as Record<string, unknown>)
        : null;

    if (itemSchema) {
      value.forEach((item, index) => {
        validateValueAgainstSchema(itemSchema, item, formatPath(path, index), issues);
      });
    }

    return;
  }

  if (value !== null && typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    const properties =
      schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
        ? (schema.properties as Record<string, Record<string, unknown>>)
        : {};
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === 'string')
      : [];
    const additionalProperties = schema.additionalProperties;

    for (const key of required) {
      if (!(key in objectValue)) {
        issues.push(`${formatPath(path, key)} is required`);
      }
    }

    for (const [key, item] of Object.entries(objectValue)) {
      const propSchema = properties[key];
      if (!propSchema) {
        if (additionalProperties === false) {
          issues.push(`${formatPath(path, key)} is not allowed`);
        }
        continue;
      }

      validateValueAgainstSchema(propSchema, item, formatPath(path, key), issues);
    }
  }
}

export function validateToolArgsAgainstSchema(
  schema: Record<string, unknown> | null | undefined,
  value: unknown,
): { ok: true } | { ok: false; issues: string[] } {
  if (!schema || typeof schema !== 'object') return { ok: true };

  const issues: string[] = [];
  validateValueAgainstSchema(schema, value, '$', issues);

  return issues.length ? { ok: false, issues } : { ok: true };
}
