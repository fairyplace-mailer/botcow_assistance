// Deterministic unit test for ciRunner without timers/env/network.

import { __setDelayForTests, __resetDelayForTests, runWorkflowAndTrack } from '../src/backend/ciRunner';

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
  afterEach(() => {
    __resetDelayForTests();
    jest.clearAllMocks();
  });

  it('runWorkflowAndTrack returns tracked result (no timers)', async () => {
    __setDelayForTests(async () => {
      // no-op delay
    });

    const res = await runWorkflowAndTrack({
      workflow_id: 'ci.yml',
      ref: 'main',
      repo: 'fairyplace-mailer/botcow_assistance',
    });

    expect(res.tracked.workflowId).toBe('ci.yml');
    expect(res.tracked.ref).toBe('main');
    expect(res.tracked.runId).toBe(123);
    expect(res.tracked.stored).toBe('repo');
  });
});
