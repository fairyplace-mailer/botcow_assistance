import { planAssistantTurn } from '../src/backend/orchestrator/planAssistantTurn';

describe('planAssistantTurn', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
  });

  test('normalizes backend hints and builds backend-owned execution contract', () => {
    const plan = planAssistantTurn({
      messages: [{ role: 'user', content: 'Сделай изменения в проекте' }],
      hints: {
        touchedFiles: ['src/a.ts', 'src/b.ts'],
        toolHeavy: true,
      },
    });

    expect(plan.normalizedHints.multiFileIntent).toBe(true);
    expect((plan.normalizedHints.longContextSize ?? 0)).toBeGreaterThan(0);
    expect(plan.execution.toolUsePolicy).toBe('tool_first');
    expect(plan.instructions).toContain('Priority of truth for runtime behavior:');
    expect(plan.instructions).toContain('Stay within the assigned task slice.');
    expect(plan.instructions).not.toContain('Execution contract is backend-owned.');
    expect(plan.instructions).not.toContain('Do not self-select another model, reasoning level, scope, or tool policy.');
    expect(plan.instructions).not.toContain('Backend-owned model:');
    expect(plan.instructions).not.toContain('Assigned routing reason:');
  });
});
