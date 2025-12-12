import { runWorkflowAndTrack, getWorkflowRunStatus } from '../src/backend/ciRunner';
import * as github from '../src/backend/github';
import * as store from '../src/backend/ciStore';

jest.mock('../src/backend/github');
jest.mock('../src/backend/ciStore');

const mockedGitHub = github as jest.Mocked<typeof github>;
const mockedStore = store as jest.Mocked<typeof store>;

describe('ciRunner', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('runWorkflowAndTrack - happy path, repo store', async () => {
    mockedGitHub.getRecentCommits.mockResolvedValue([{ sha: 'abc123' } as any]);
    mockedGitHub.runWorkflow.mockResolvedValue({ status: 'dispatched' } as any);
    mockedGitHub.listWorkflowRuns.mockResolvedValue({ runs: [{ id: 1, head_sha: 'abc123', created_at: new Date().toISOString() }] } as any);
    mockedGitHub.getFile.mockResolvedValue('{}' as any);
    mockedGitHub.commitFile.mockResolvedValue({} as any);

    const { tracked } = await runWorkflowAndTrack({ workflow_id: 'ci.yml', ref: 'botcow-prevectus', repo: 'fairyplace-mailer/botcow_assistance' });

    expect(tracked.runId).toBe(1);
    expect(tracked.stored).toBe('repo');
    expect(mockedGitHub.commitFile).toHaveBeenCalled();
  });

  test('runWorkflowAndTrack - fallback to local store when commit fails', async () => {
    mockedGitHub.getRecentCommits.mockResolvedValue([{ sha: 'def456' } as any]);
    mockedGitHub.runWorkflow.mockResolvedValue({ status: 'dispatched' } as any);
    mockedGitHub.listWorkflowRuns.mockResolvedValue({ runs: [{ id: 2, head_sha: 'def456', created_at: new Date().toISOString() }] } as any);
    mockedGitHub.getFile.mockResolvedValue('{}' as any);
    mockedGitHub.commitFile.mockRejectedValue({ status: 403 });
    mockedStore.saveRun.mockResolvedValue(undefined as any);

    const { tracked } = await runWorkflowAndTrack({ workflow_id: 'ci.yml', ref: 'botcow-prevectus', repo: 'fairyplace-mailer/botcow_assistance' });

    expect(tracked.runId).toBe(2);
    expect(tracked.stored).toBe('local');
    expect(mockedStore.saveRun).toHaveBeenCalled();
  });

  test('getWorkflowRunStatus - normalizes response', async () => {
    mockedGitHub.getWorkflowStatus.mockResolvedValue({ id: 5, status: 'completed', conclusion: 'success', created_at: '2020-01-01', updated_at: '2020-01-01', html_url: 'http://', head_branch: 'botcow-prevectus', head_sha: 'abc' } as any);

    const res = await getWorkflowRunStatus({ run_id: 5, repo: 'fairyplace-mailer/botcow_assistance' });
    expect(res.run_id).toBe(5);
    expect(res.status).toBe('completed');
  });

  test('getWorkflowRunStatus - throws on 403', async () => {
    mockedGitHub.getWorkflowStatus.mockRejectedValue({ status: 403 });
    await expect(getWorkflowRunStatus({ run_id: 99 })).rejects.toThrow('Actions/workflow permissions');
  });
});
