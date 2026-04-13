import { computeDevWixBudgetSnapshot } from '../src/backend/devWixDocs/budgetPolicy';

describe('computeDevWixBudgetSnapshot external budget families', () => {
  beforeEach(() => {
    delete process.env.BOTCOW_GITHUB_QUOTA_PRESSURE_RATIO;
    delete process.env.BOTCOW_MODEL_TOKEN_USAGE;
    delete process.env.BOTCOW_MODEL_TOKEN_LIMIT;
  });

  test('external github quota pressure can dominate budget mode', () => {
    process.env.BOTCOW_GITHUB_QUOTA_PRESSURE_RATIO = '0.95';

    const result = computeDevWixBudgetSnapshot({
      officialChunks: 10,
      embeddingBudgetLimit: 1000,
      dbBudgetLimit: 1000,
    });

    expect(result.budgetMode).toBe('aggressive');
    expect(result.pressureRatio).toBe(0.95);
    expect(result.dominantPressureFamily).toBe('github');
    expect(result.embeddingPressureRatio).toBe(0.01);
    expect(result.dbPressureRatio).toBe(0.01);
  });

  test('token usage/limit pair is supported as warning pressure', () => {
    process.env.BOTCOW_MODEL_TOKEN_USAGE = '720';
    process.env.BOTCOW_MODEL_TOKEN_LIMIT = '1000';

    const result = computeDevWixBudgetSnapshot({
      officialChunks: 0,
      embeddingBudgetLimit: 1000,
      dbBudgetLimit: 1000,
    });

    expect(result.budgetMode).toBe('warning');
    expect(result.pressureRatio).toBe(0.72);
    expect(result.dominantPressureFamily).toBe('tokens');
    expect(result.tokenPressureRatio).toBe(0.72);
  });
});
