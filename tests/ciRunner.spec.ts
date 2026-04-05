// Deterministic unit test for ciRunner without timers/env/network.

import { runWorkflowAndTrack, getTrackedWorkflowRun } from '../src/backend/ciRunner';
import { __resetTrackedRunsForTests } from '../src/backend/ciStore';

// Mock the github module functions that ciRunner imports.
jest.mock('../src/backend/github', () => {
  return {
    runWorkflow: jest.fn().mockResolvedValue({ dispatched: true }),
    // return commit sha so runner can match by head_sha
    getRecentCommits: jest.fn().mockResolvedValue([{ sha: 'deadbeef' }]),
    // first poll empty, second poll contains matching run
    listWorkflowRuns: jest
      .fn()
      .mockResolvedValueOnce({ total_count: 0, runs: [] })
      .mockResolvedValueOnce({
        total_count: 1,
        runs: [
          {
            id: 123,
            head_sha: 'deadbeef',
            created_at: new Date().toISOString(),
          },
        ],
      }),
    getWorkflowStatus: jest.fn(),
    // repo file store
    getFile: jest.fn().mockRejectedValue({ status: 404 }),
    commitFile: jest.fn().mockResolvedValue({}),
  };
});

// saveRun should not be used if commitFile succeeds.
jest.mock('../src/backend/ciStore', () => ({
  saveRun: jest.fn().mockResolvedValue(undefined),
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
