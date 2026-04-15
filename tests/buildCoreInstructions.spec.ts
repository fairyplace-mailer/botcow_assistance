import { buildCoreInstructions } from '../src/backend/prompt/buildCoreInstructions';

describe('buildCoreInstructions', () => {
  test('includes priority of truth and backend-owned execution contract', () => {
    const text = buildCoreInstructions({
      routing: {
        model: 'gpt-5.4',
        reasoning: { effort: 'high' },
        reason: 'golden-core-self-rewrite',
      },
      hints: {
        touchedFiles: ['src/backend/assistant.ts'],
      },
      execution: {
        model: 'gpt-5.4',
        reasoningEffort: 'high',
        responseVerbosity: 'medium',
        maxOutputTokens: 24000,
        toolUsePolicy: 'tool_first',
      },
    });

    expect(text).toContain('Priority of truth for runtime behavior:');
    expect(text).toContain('Execution contract is backend-owned.');
    expect(text).toContain('Backend-owned model: gpt-5.4.');
    expect(text).toContain('This is a strong-mode task slice. Be conservative and evidence-first.');
  });

  test('adds nano-specific restriction profile', () => {
    const text = buildCoreInstructions({
      routing: {
        model: 'gpt-5.4-nano',
        reason: 'classification-or-extraction-or-ranking',
      },
      hints: {},
      execution: {
        model: 'gpt-5.4-nano',
        reasoningEffort: 'none',
        responseVerbosity: 'low',
        maxOutputTokens: 4000,
        toolUsePolicy: 'minimal',
      },
    });

    expect(text).toContain('This is a narrow classification/extraction/ranking profile.');
    expect(text).toContain('Do not attempt architecture, deep debug, or risky rewrites.');
  });
});
