import { __setGithubClientForTests } from '../src/backend/github';

// Minimal fake Octokit-like surface used by ciRunner.
const fakeGithub: any = {
  repos: {
    listCommits: jest.fn().mockResolvedValue({
      data: [
        {
          sha: 'deadbeef',
          commit: {
            author: {
              name: 'bot',
              email: 'bot@example.com',
              date: new Date().toISOString(),
            },
            message: 'x',
          },
          html_url: 'https://example.com',
        },
      ],
    }),
    getContent: jest.fn().mockRejectedValue({ status: 404 }),
    createOrUpdateFileContents: jest.fn().mockResolvedValue({ data: {} }),
  },
  actions: {
    createWorkflowDispatch: jest.fn().mockResolvedValue({}),
    // first poll returns no runs, second poll returns a matching run id
    listWorkflowRuns: jest
      .fn()
      .mockResolvedValueOnce({ data: { total_count: 0, workflow_runs: [] } })
      .mockResolvedValueOnce({
        data: {
          total_count: 1,
          workflow_runs: [
            {
              id: 123,
              head_sha: 'deadbeef',
              created_at: new Date().toISOString(),
              event: 'workflow_dispatch',
            },
          ],
        },
      }),
    listWorkflowRunsForRepo: jest.fn().mockResolvedValue({ data: { total_count: 0, workflow_runs: [] } }),
    getWorkflowRun: jest.fn().mockResolvedValue({
      data: { id: 1, status: 'completed', conclusion: 'success' },
    }),
  },
};

__setGithubClientForTests(fakeGithub);

import { runWorkflowAndTrack } from '../src/backend/ciRunner';

describe('ciRunner', () => {
  it('runWorkflowAndTrack returns tracked result', async () => {
    jest.useFakeTimers();

    const p = runWorkflowAndTrack({
      workflow_id: 'ci.yml',
      ref: 'main',
      repo: 'fairyplace-mailer/botcow_assistance',
    });

    // allow the first poll + its backoff timer to be scheduled
    await Promise.resolve();

    // fast-forward enough for at least one backoff + second poll
    jest.runOnlyPendingTimers();
    jest.runOnlyPendingTimers();

    const res = await p;

    expect(res).toHaveProperty('tracked');
    expect(res.tracked).toHaveProperty('workflowId', 'ci.yml');

    // In our mock, the second poll returns run id 123
    expect(res.tracked.runId).toBe(123);

    jest.useRealTimers();
  }, 15000);
});
