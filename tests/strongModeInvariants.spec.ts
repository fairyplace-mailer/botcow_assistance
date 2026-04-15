import { chooseModel } from '../src/backend/modelRouter';
import { planAssistantTurn } from '../src/backend/orchestrator/planAssistantTurn';

describe('strong mode invariants', () => {
  test('golden core rewrite always routes to full model with high reasoning', () => {
    const result = chooseModel(
      [{ role: 'user', content: 'Carefully rewrite the backend runtime core.' }],
      { touchedFiles: ['src/backend/prompt/buildCoreInstructions.ts'] },
    );

    expect(result.model).toBe('gpt-5.4');
    expect(result.reason).toBe('golden-core-self-rewrite');
    expect(result.reasoning?.effort).toBe('high');
  });

  test('repo audit/spec compliance uses strong mode', () => {
    const result = chooseModel(
      [{ role: 'user', content: 'Audit this repo against docs/strong_spec.md and list mismatches.' }],
      { touchedFiles: ['src/backend/tools/githubTools.ts'] },
    );

    expect(result.model).toBe('gpt-5.4');
    expect(result.reason).toBe('repo-audit-or-spec-compliance');
    expect(result.reasoning?.effort).toBe('high');
  });

  test('ordinary code task keeps reasoning off by default', () => {
    const result = chooseModel(
      [{ role: 'user', content: 'Refactor this small React button component without changing behavior.' }],
      { touchedFiles: ['src/components/Button.tsx'] },
    );

    expect(result.reasoning).toBeUndefined();
  });

  test('planAssistantTurn keeps tool-first policy for architecture work', () => {
    const plan = planAssistantTurn({
      messages: [{ role: 'user', content: 'Redesign the backend architecture for stability.' }],
      hints: { touchedFiles: ['src/backend/assistant.ts'] },
    });

    expect(plan.routing.model).toBe('gpt-5.4');
    expect(plan.routing.reason).toBe('golden-core-self-rewrite');
    expect(plan.execution.reasoningEffort).toBe('high');
    expect(plan.execution.toolUsePolicy).toBe('tool_first');
    expect(plan.run.reasoning).toEqual({ effort: 'high' });
  });

  test('planAssistantTurn keeps reasoning absent for ordinary task slices', () => {
    const plan = planAssistantTurn({
      messages: [{ role: 'user', content: 'Rename a few props in this UI component.' }],
      hints: { touchedFiles: ['src/components/Card.tsx'] },
    });

    expect(plan.execution.reasoningEffort).toBe('none');
    expect(plan.run.reasoning).toBeUndefined();
  });
});
