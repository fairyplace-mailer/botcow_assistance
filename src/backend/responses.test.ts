import { buildResponsesCreateParams } from './responses';

describe('buildResponsesCreateParams', () => {
  test('builds previous_response state payload', () => {
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
      state: { kind: 'previous_response', previousResponseId: 'resp_prev' },
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
      reasoning: { effort: 'low' },
      parallel_tool_calls: false,
    });
    expect(result).not.toHaveProperty('conversation');
  });

  test('builds conversation state payload', () => {
    const result = buildResponsesCreateParams({
      model: 'gpt-5.4-mini',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'hello' }],
        },
      ],
      state: { kind: 'conversation', conversation: { id: 'conv_1' } },
    });

    expect(result).toMatchObject({
      model: 'gpt-5.4-mini',
      conversation: { id: 'conv_1' },
      parallel_tool_calls: false,
    });
    expect(result).not.toHaveProperty('previous_response_id');
  });

  test('omits optional fields cleanly for stateless mode', () => {
    const result = buildResponsesCreateParams({
      model: 'gpt-5.4-mini',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'hello' }],
        },
      ],
      state: { kind: 'stateless' },
    });

    expect(result.model).toBe('gpt-5.4-mini');
    expect(result.parallel_tool_calls).toBe(false);
    expect(result).not.toHaveProperty('instructions');
    expect(result).not.toHaveProperty('previous_response_id');
    expect(result).not.toHaveProperty('conversation');
    expect(result).not.toHaveProperty('reasoning');
    expect(result.tools).toEqual([]);
  });

  test('throws on invalid conversation state', () => {
    expect(() =>
      buildResponsesCreateParams({
        model: 'gpt-5.4-mini',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'hello' }],
          },
        ],
        state: { kind: 'conversation', conversation: { id: '' } },
      }),
    ).toThrow('Responses state validation failed: conversation.id is required');
  });

  test('throws on invalid previous_response state', () => {
    expect(() =>
      buildResponsesCreateParams({
        model: 'gpt-5.4-mini',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'hello' }],
          },
        ],
        state: { kind: 'previous_response', previousResponseId: '' },
      }),
    ).toThrow('Responses state validation failed: previousResponseId is required');
  });
});
