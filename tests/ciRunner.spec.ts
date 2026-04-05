// Deterministic unit test for ciRunner without timers/env/network.

const mockRunWorkflow = jest.fn();
const mockGetRecentCommits = jest.fn();
const mockListWorkflowRuns = jest.fn();
const mockGetWorkflowStatus = jest.fn();
const mockGetFile = jest.fn();
const mockCommitFile = jest.fn();

jest.mock('../src/backend/github', () => ({
  runWorkflow: mockRunWorkflow,
  getRecentCommits: mockGetRecentCommits,
  listWorkflowRuns: mockListWorkflowRuns,
  getWorkflowStatus: mockGetWorkflowStatus,
  getFile: mockGetFile,
  commitFile: mockCommitFile,
}));

jest.mock('../src/backend/ciStore', () => {
  const actual = jest.requireActual('../src/backend/ciStore');
  return {
    ...actual,
    saveRun: jest.fn().mockResolvedValue(undefined),
  };
});

const { runWorkflowAndTrack, getTrackedWorkflowRun } = require('../src/backend/ciRunner');
const { __resetTrackedRunsForTests } = require('../src/backend/ciStore');

describe('ciRunner', () => {
  beforeEach(() => {
    __resetTrackedRunsForTests();
    jest.clearAllMocks();
    jest.useRealTimers();

    mockRunWorkflow.mockResolvedValue({ dispatched: true });
    mockGetRecentCommits.mockResolvedValue([{ sha: 'deadbeef' }]);
    mockListWorkflowRuns.mockResolvedValue({
      total_count: 1,
      runs: [
        {
          id: 123,
          head_sha: 'deadbeef',
          created_at: new Date().toISOString(),
        },
      ],
    });
    mockGetWorkflowStatus.mockResolvedValue(undefined);
    mockGetFile.mockRejectedValue({ status: 404 });
    mockCommitFile.mockResolvedValue({});
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

    expect(mockRunWorkflow).toHaveBeenCalledTimes(1);
    expect(mockListWorkflowRuns).toHaveBeenCalledTimes(1);

    expect(result.tracked.runId).toBe(123);
    expect(result.tracked.workflowId).toBe('tests.yml');
    expect(result.tracked.ref).toBe('provecta');

    const tracked = getTrackedWorkflowRun(123);
    expect(tracked?.status).toBe('queued');
  });
});
