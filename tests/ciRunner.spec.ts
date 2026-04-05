import { __resetTrackedRunsForTests, getTrackedWorkflowRun, runWorkflowAndTrack } from '../src/backend/ciRunner';

jest.mock('../src/backend/github', () => ({
  runWorkflow: jest.fn(async () => ({ run_id: 123 })),
  getWorkflowStatus: jest.fn(),
  listWorkflowRuns: jest.fn(),
  getFile: jest.fn(),
  getRecentCommits: jest.fn(),
  commitFile: jest.fn(),
}));

describe('ciRunner', () => {
  beforeEach(() => {
    __resetTrackedRunsForTests();
    jest.useRealTimers();
  });

  test('runWorkflowAndTrack returns tracked result (no timers)', async () => {
    const startedAt = new Date().toISOString();
    const result = await runWorkflowAndTrack({
      repo: 'fairyplace-mailer/botcow_assistance',
      workflow_id: 'tests.yml',
      ref: 'provecta',
      inputs: { hello: 'world' },
      startedAt,
    });

    expect(result.tracked.runId).toBe(123);
    expect(result.tracked.workflowId).toBe('tests.yml');
    expect(result.tracked.ref).toBe('provecta');

    const tracked = getTrackedWorkflowRun(123);
    expect(tracked?.status).toBe('queued');
  });
});
