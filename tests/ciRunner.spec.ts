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
    listWorkflowRuns: jest.fn().mockResolvedValue({ data: { total_count: 0, workflow_runs: [] } }),
    listWorkflowRunsForRepo: jest.fn().mockResolvedValue({ data: { total_count: 0, workflow_runs: [] } }),
    getWorkflowRun: jest.fn().mockResolvedValue({ data: { id: 1, status: 'completed', conclusion: 'success' } }),
  },
};

__setGithubClientForTests(fakeGithub);

import { runWorkflowAndTrack } from '../src/backend/ciRunner';

describe('ciRunner', () => {
  it('runWorkflowAndTrack returns tracked result', async () => {
    const res = await runWorkflowAndTrack({
      workflow_id: 'ci.yml',
      ref: 'main',
      repo: 'fairyplace-mailer/botcow_assistance',
    });

    expect(res).toHaveProperty('tracked');
    expect(res.tracked).toHaveProperty('workflowId', 'ci.yml');
  });
});
