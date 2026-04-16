import { buildCoreInstructions } from '../src/backend/prompt/buildCoreInstructions';

describe('buildCoreInstructions', () => {
  test('includes updated priority of truth without exposing orchestrator metadata', () => {
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
    expect(text).toContain('1. supported OpenAI Responses API strong-mode/runtime rules and contract;');
    expect(text).toContain('2. docs/strong_spec.md;');
    expect(text).toContain('Stay within the assigned task slice.');
    expect(text).toContain('Be conservative and check edge cases before concluding.');

    expect(text).not.toContain('Backend-owned model:');
    expect(text).not.toContain('Backend-owned reasoning effort:');
    expect(text).not.toContain('Backend-owned tool-use policy:');
    expect(text).not.toContain('Current routing reason:');
    expect(text).not.toContain('Assigned routing reason:');
    expect(text).not.toContain('Execution contract is backend-owned.');
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
