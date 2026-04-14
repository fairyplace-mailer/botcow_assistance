import {
  hashToolArgs,
  makeToolFingerprint,
  normalizeStrictToolArgs,
  safeParseToolArgs,
  stableStringify,
  validateToolArgsAgainstSchema,
} from '../src/backend/guards/toolArgs';

describe('toolArgs guards', () => {
  test('stableStringify is stable for object key order', () => {
    expect(stableStringify({ b: 2, a: 1 })).toBe(stableStringify({ a: 1, b: 2 }));
  });

  test('hashToolArgs and makeToolFingerprint are stable', () => {
    expect(hashToolArgs({ b: 2, a: 1 })).toBe(hashToolArgs({ a: 1, b: 2 }));
    expect(makeToolFingerprint('x', { b: 2, a: 1 })).toBe(makeToolFingerprint('x', { a: 1, b: 2 }));
  });

  test('safeParseToolArgs rejects invalid json', () => {
    expect(safeParseToolArgs('{')).toEqual({ ok: false });
  });

  test('normalizeStrictToolArgs removes undefined deeply', () => {
    expect(
      normalizeStrictToolArgs({
        a: 1,
        b: undefined,
        c: [1, undefined, { x: 2, y: undefined }],
      }),
    ).toEqual({
      a: 1,
      c: [1, { x: 2 }],
    });
  });

  test('validateToolArgsAgainstSchema validates nested objects arrays enum and limits', () => {
    const schema = {
      type: 'object',
      properties: {
        repo: { type: 'string', minLength: 3 },
        mode: { type: 'string', enum: ['quick', 'full'] },
        options: {
          type: 'object',
          properties: {
            retry: { type: 'integer', minimum: 0, maximum: 3 },
            paths: {
              type: 'array',
              minItems: 1,
              maxItems: 2,
              items: {
                type: 'string',
                minLength: 2,
              },
            },
          },
          required: ['retry', 'paths'],
          additionalProperties: false,
        },
      },
      required: ['repo', 'mode', 'options'],
      additionalProperties: false,
    } as const;

    expect(
      validateToolArgsAgainstSchema(schema as any, {
        repo: 'ab',
        mode: 'deep',
        options: {
          retry: 10,
          paths: ['x', 5, 'okay'],
          extra: true,
        },
        unknown: true,
      }),
    ).toEqual({
      ok: false,
      issues: [
        '$.repo must have length >= 3',
        '$.mode must be one of: "quick", "full"',
        '$.options.retry must be <= 3',
        '$.options.paths must contain at most 2 items',
        '$.options.paths[0] must have length >= 2',
        '$.options.paths[1] must be string, got number',
        '$.options.extra is not allowed',
        '$.unknown is not allowed',
      ],
    });
  });

  test('validateToolArgsAgainstSchema validates required nested fields', () => {
    const schema = {
      type: 'object',
      properties: {
        options: {
          type: 'object',
          properties: {
            branch: { type: ['string', 'null'] },
          },
          required: ['branch'],
          additionalProperties: false,
        },
      },
      required: ['options'],
      additionalProperties: false,
    } as const;

    expect(validateToolArgsAgainstSchema(schema as any, {})).toEqual({
      ok: false,
      issues: ['$.options is required'],
    });

    expect(
      validateToolArgsAgainstSchema(schema as any, {
        options: {},
      }),
    ).toEqual({
      ok: false,
      issues: ['$.options.branch is required'],
    });
  });
});
