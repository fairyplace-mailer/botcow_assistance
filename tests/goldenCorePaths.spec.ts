import { hasGoldenCoreTouch, isGoldenCorePath } from '../src/backend/guards/goldenCore';

describe('golden core path matching', () => {
  test('matches canonical core files', () => {
    expect(isGoldenCorePath('src/backend/assistant.ts')).toBe(true);
    expect(isGoldenCorePath('./src/backend/openai.ts')).toBe(true);
  });

  test('matches canonical core directories introduced by replacement runtime', () => {
    expect(isGoldenCorePath('src/backend/prompt/buildCoreInstructions.ts')).toBe(true);
    expect(isGoldenCorePath('src/backend/contracts/chat.ts')).toBe(true);
    expect(isGoldenCorePath('src/backend/guards/toolArgs.ts')).toBe(true);
    expect(isGoldenCorePath('tests/contracts/modelRouter.contract.test.ts')).toBe(true);
  });

  test('does not match ordinary non-core files', () => {
    expect(isGoldenCorePath('src/backend/tools/githubTools.ts')).toBe(false);
    expect(isGoldenCorePath('tests/assistantRouting.spec.ts')).toBe(false);
  });

  test('detects touched files batch', () => {
    expect(
      hasGoldenCoreTouch([
        'src/backend/tools/githubTools.ts',
        'src/backend/prompt/modelSpecificInstructions.ts',
      ]),
    ).toBe(true);

    expect(
      hasGoldenCoreTouch([
        'src/backend/tools/githubTools.ts',
        'tests/assistantRouting.spec.ts',
      ]),
    ).toBe(false);
  });
});
