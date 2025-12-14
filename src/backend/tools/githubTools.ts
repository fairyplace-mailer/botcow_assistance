import {
  createIssue,
  createPullRequest,
  getFile,
  getRepoStructure,
  downloadWorkflowRunLogs,
  listIssues,
  listPullRequests,
  listRepoFiles,
  listWorkflowRunJobs,
  listWorkflowRuns,
  mergePullRequest,
  searchInRepo,
  updateIssue,
} from '../github';

export const githubTools = {
  async github_get_repo_structure(args: { repo?: string }) {
    return getRepoStructure({ repo: args.repo });
  },

  async github_list_files(args: { path?: string; repo?: string }) {
    return listRepoFiles({ path: args.path, repo: args.repo });
  },

  async github_get_file(args: { path: string; repo?: string }) {
    return getFile(args.path, args.repo);
  },

  async github_search_in_repo(args: { query: string; path?: string; repo?: string }) {
    return searchInRepo({ query: args.query, path: args.path, repo: args.repo });
  },

  async github_list_pull_requests(args: { repo?: string }) {
    return listPullRequests({ repo: args.repo });
  },

  async github_create_pull_request(args: {
    title: string;
    head: string;
    base?: string;
    body?: string;
    repo?: string;
  }) {
    return createPullRequest({
      title: args.title,
      head: args.head,
      base: args.base,
      body: args.body,
      repo: args.repo,
    });
  },

  async github_merge_pull_request(args: {
    pull_number: number;
    method?: 'merge' | 'squash' | 'rebase';
    repo?: string;
  }) {
    return mergePullRequest({ pull_number: args.pull_number, method: args.method, repo: args.repo });
  },

  async github_create_issue(args: {
    title: string;
    body?: string;
    labels?: string[];
    assignees?: string[];
    repo?: string;
  }) {
    return createIssue({
      title: args.title,
      body: args.body,
      labels: args.labels,
      assignees: args.assignees,
      repo: args.repo,
    });
  },

  async github_update_issue(args: {
    issue_number: number;
    title?: string;
    body?: string;
    state?: 'open' | 'closed';
    labels?: string[];
    assignees?: string[];
    repo?: string;
  }) {
    return updateIssue({
      issue_number: args.issue_number,
      title: args.title,
      body: args.body,
      state: args.state,
      labels: args.labels,
      assignees: args.assignees,
      repo: args.repo,
    });
  },

  async github_list_issues(args: { state?: 'open' | 'closed' | 'all'; labels?: string[]; repo?: string }) {
    return listIssues({ state: args.state, labels: args.labels, repo: args.repo });
  },

  async github_list_workflow_runs(args: { workflow_id?: string; repo?: string }) {
    return listWorkflowRuns(
      args.repo ? { workflow_id: args.workflow_id, repo: args.repo } : { workflow_id: args.workflow_id },
    );
  },

  async github_list_workflow_run_jobs(args: { run_id: number; repo?: string }) {
    return listWorkflowRunJobs(args.repo ? { run_id: args.run_id, repo: args.repo } : { run_id: args.run_id });
  },

  async github_download_workflow_run_logs(args: { run_id: number; repo?: string }) {
    return downloadWorkflowRunLogs(args.repo ? { run_id: args.run_id, repo: args.repo } : { run_id: args.run_id });
  },
};
