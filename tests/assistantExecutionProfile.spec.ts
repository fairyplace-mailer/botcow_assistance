import { buildExecutionProfile } from '../src/backend/guards/assistantExecutionProfile';

describe('assistantExecutionProfile', () => {
  test('keeps normal execution mode for fix tasks that only mention strong_spec and Responses API priorities', () => {
    const profile = buildExecutionProfile({
      baseInstructions: 'Treat docs/strong_spec.md as the primary project spec.',
      detectionText:
        'Сделай код бота стабильным. Если есть конфликт между кодом, docs/strong_spec.md и strong mode Responses API, соблюдай приоритет спецификации.',
    });

    expect(profile.mode).toBe('default');
  });

  test('switches to repo audit mode only for explicit audit requests', () => {
    const profile = buildExecutionProfile({
      baseInstructions: 'Treat docs/strong_spec.md as the primary project spec.',
      detectionText:
        'Make a full audit against docs/strong_spec.md. Check strict mode and do not change anything.',
    });

    expect(profile.mode).toBe('repo_audit');
  });
});
