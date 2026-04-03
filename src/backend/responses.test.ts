import { buildResponsesCreateParams } from './responses';

describe('buildResponsesCreateParams', () => {
  test('builds canonical responses payload with all supported fields', () => {
    const result = buildResponsesCreateParams({
      model: 'gpt-5.4-mini',
      instructions: 'sys',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'hello' }],
        },
      ],
      previousResponseId: 'resp_prev',
      conversation: { id: 'conv_1' },
      reasoning: { effort: 'low' },
      tools: [
        {
          type: 'function',
          function: {
            name: 'toolA',
            description: 'toolA',
            parameters: {
              type: 'object',
              properties: {
                value: { type: 'string' },
              },
              required: ['value'],
              additionalProperties: false,
            },
          },
        } as any,
      ],
    });

    expect(result).toMatchObject({
      model: 'gpt-5.4-mini',
      instructions: 'sys',
      previous_response_id: 'resp_prev',
      conversation: { id: 'conv_1' },
      reasoning: { effort: 'low' },
      parallel_tool_calls: false,
    });

    expect(Array.isArray(result.input)).toBe(true);
    expect(Array.isArray(result.tools)).toBe(true);
    expect((result.tools as any[])[0]).toMatchObject({
      type: 'function',
      name: 'toolA',
      strict: true,
    });
  });

  test('omits optional fields cleanly', () => {
    const result = buildResponsesCreateParams({
      model: 'gpt-5.4-mini',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'hello' }],
        },
      ],
    });

    expect(result.model).toBe('gpt-5.4-mini');
    expect(result.parallel_tool_calls).toBe(false);
    expect(result).not.toHaveProperty('instructions');
    expect(result).not.toHaveProperty('previous_response_id');
    expect(result).not.toHaveProperty('conversation');
    expect(result).not.toHaveProperty('reasoning');
    expect(result.tools).toEqual([]);
  });
});
