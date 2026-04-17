import { planAssistantTurn } from '../src/backend/orchestrator/planAssistantTurn';

describe('routing hints boundary', () => {
  test('internal routing hints still influence planning after removal from public chat contract', () => {
    const plan = planAssistantTurn({
      messages: [{ role: 'user', content: 'Audit the repo against docs/strong_spec.md.' }],
      hints: {
        touchedFiles: ['src/backend/runtime/runAssistantRuntime.ts'],
        toolHeavy: true,
      },
    });

    expect(plan.routing.model).toBe('gpt-5.4');
    expect(plan.execution.toolUsePolicy).toBe('tool_first');
    expect(plan.normalizedHints.touchedFiles).toEqual(['src/backend/runtime/runAssistantRuntime.ts']);
  });
});
