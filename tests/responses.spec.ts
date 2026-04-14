import {
  buildStrictFunctionTools,
  createModelResponse,
  extractConversationId,
  extractFinalAssistantMessage,
  extractFunctionCalls,
  normalizePublicChatError,
  normalizePublicChatSuccess,
  responseUsage,
  validateResponsesToolsContract,
} from '../src/backend/responses';

describe('responses helpers', () => {
  test('buildStrictFunctionTools forces strict function schemas', () => {
    expect(
      buildStrictFunctionTools([
        {
          type: 'function',
          name: 'tool_one',
          description: 'tool one',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        } as any,
      ] as any),
    ).toEqual([
      {
        type: 'function',
        name: 'tool_one',
        description: 'tool one',
        strict: true,
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
    ]);
  });

  test('buildStrictFunctionTools normalizes legacy wrapped function tools', () => {
    expect(
      buildStrictFunctionTools([
        {
          type: 'function',
          function: {
            name: 'tool_one',
            description: 'tool one',
            parameters: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
          },
        } as any,
      ] as any),
    ).toEqual([
      {
        type: 'function',
        name: 'tool_one',
        description: 'tool one',
        strict: true,
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
    ]);
  });

  test('validateResponsesToolsContract rejects unsupported strict-schema keywords', () => {
    expect(
      validateResponsesToolsContract([
        {
          type: 'function',
          name: 'tool_one',
          description: 'tool one',
          parameters: {
            type: 'object',
            properties: {
              paths: {
                type: 'array',
                items: { type: 'string' },
                minItems: 1,
              },
            },
            required: ['paths'],
            additionalProperties: false,
          },
        } as any,
      ] as any),
    ).toEqual({
      ok: false,
      issues: ['tool_one: unsupported strict-schema key at $.properties.paths.minItems'],
    });
  });


  test('validateResponsesToolsContract rejects object properties that are not fully required', () => {
    expect(
      validateResponsesToolsContract([
        {
          type: 'function',
          name: 'tool_two',
          description: 'tool two',
          parameters: {
            type: 'object',
            properties: {
              repo: { type: ['string', 'null'] },
              options: {
                type: 'object',
                properties: {
                  branch: { type: ['string', 'null'] },
                },
                required: [],
              },
            },
            required: ['repo'],
            additionalProperties: false,
          },
        } as any,
      ] as any),
    ).toEqual({
      ok: false,
      issues: [
        'tool_two: object schema at $ must require property options',
        'tool_two: object schema at $.properties.options must set additionalProperties=false',
        'tool_two: object schema at $.properties.options must require property branch',
      ],
    });
  });

  test('createModelResponse sends conversation state only when conversation mode selected', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'resp' });
    const client = { responses: { create } } as any;

    await createModelResponse({
      client,
      model: 'gpt-5.4',
      instructions: 'DEV_INSTR',
      state: { kind: 'conversation', conversation: { id: 'conv-1' } },
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }] as any,
      tools: [],
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: 'DEV_INSTR',
        conversation: { id: 'conv-1' },
        parallel_tool_calls: false,
      }),
    );
    expect(create.mock.calls[0][0].previous_response_id).toBeUndefined();
  });

  test('createModelResponse sends previous_response_id only when previous_response mode selected', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'resp' });
    const client = { responses: { create } } as any;

    await createModelResponse({
      client,
      model: 'gpt-5.4',
      instructions: 'DEV_INSTR',
      state: { kind: 'previous_response', previousResponseId: 'resp-1' },
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }] as any,
      tools: [],
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: 'DEV_INSTR',
        previous_response_id: 'resp-1',
        parallel_tool_calls: false,
      }),
    );
    expect(create.mock.calls[0][0].conversation).toBeUndefined();
  });

  test('extractFinalAssistantMessage prefers output_text shortcut', () => {
    expect(
      extractFinalAssistantMessage({
        output_text: 'done',
        output: [
          {
            type: 'message',
            role: 'assistant',
            phase: 'commentary',
            content: [{ type: 'output_text', text: 'thinking' }],
          },
        ],
      } as any),
    ).toEqual({
      phase: 'final_answer',
      text: 'done',
    });
  });

  test('extractFinalAssistantMessage reads last assistant message phase', () => {
    expect(
      extractFinalAssistantMessage({
        output: [
          {
            type: 'message',
            role: 'assistant',
            phase: 'commentary',
            content: [{ type: 'output_text', text: 'thinking' }],
          },
          {
            type: 'message',
            role: 'assistant',
            phase: 'final_answer',
            content: [{ type: 'output_text', text: 'done' }],
          },
        ],
      } as any),
    ).toEqual({
      phase: 'final_answer',
      text: 'done',
    });
  });

  test('extractFunctionCalls reads name arguments and call_id', () => {
    expect(
      extractFunctionCalls([
        {
          type: 'function_call',
          call_id: 'call_123',
          name: 'tool_one',
          arguments: '{"q":"abc"}',
        } as any,
      ]),
    ).toEqual([
      {
        call_id: 'call_123',
        name: 'tool_one',
        arguments: '{"q":"abc"}',
      },
    ]);
  });

  test('extractConversationId prefers response conversation and falls back otherwise', () => {
    expect(
      extractConversationId({ conversation: { id: 'conv_1' } } as any, 'fallback'),
    ).toBe('conv_1');
    expect(extractConversationId({} as any, 'fallback')).toBe('fallback');
  });

  test('normalizePublicChatSuccess maps canonical response payload', () => {
    expect(
      normalizePublicChatSuccess({
        sessionId: 'session_1',
        response: {
          id: 'resp_1',
          model: 'gpt-5.4',
          output_text: 'done',
        } as any,
        routing: {
          model: 'gpt-5.4',
          reason: 'deep-code-debug-review',
          reasoning: { effort: 'high' },
        } as any,
        state: {
          conversationId: 'conv_1',
          previousResponseId: 'resp_1',
        },
      }),
    ).toEqual({
      ok: true,
      sessionId: 'session_1',
      response: {
        id: 'resp_1',
        model: 'gpt-5.4',
        phase: 'final_answer',
        outputText: 'done',
        reason: 'deep-code-debug-review',
        reasoningEffort: 'high',
        state: {
          conversationId: 'conv_1',
          previousResponseId: 'resp_1',
        },
      },
      error: null,
    });
  });

  test('normalizePublicChatError hides internal details', () => {
    expect(
      normalizePublicChatError({
        sessionId: 'session_1',
        code: 'assistant_run_failed',
        message: 'Chat request failed.',
      }),
    ).toEqual({
      ok: false,
      sessionId: 'session_1',
      response: null,
      error: {
        code: 'assistant_run_failed',
        message: 'Chat request failed.',
      },
    });
  });

  test('responseUsage returns usage or null', () => {
    expect(responseUsage({ usage: { total_tokens: 10 } } as any)).toEqual({ total_tokens: 10 });
    expect(responseUsage({} as any)).toBeNull();
  });
});
