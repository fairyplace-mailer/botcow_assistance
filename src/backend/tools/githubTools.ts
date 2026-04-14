import {
  commitFile,
  createBranch,
  createIssue,
  createPullRequest,
  deleteFile,
  downloadWorkflowRunLogs,
  getFile,
  getFilesBatch,
  getRepoStructure,
  listFiles,
  listIssues,
  listWorkflowRunJobs,
  listWorkflowRuns,
  mergePullRequest,
  searchInRepo,
  updateIssue,
  getGithubClient,
} from '../github';
import {
  githubDiagnoseLatestWorkflowRun,
  githubDiagnoseWorkflowRun,
  githubGetWorkflowRunLogsText,
} from '../ciDiagnostics';
import { githubDiagnoseActionsSetup } from '../diagnostics/actionsDiagnostics';

/**
 * JSON schemas tools for OpenAI (function calling).
 */
export const githubToolsSchemas = [
  {
    type: 'function',
    function: {
      name: 'github_get_repo_structure',
      description: 'Get repository structure as a tree, optionally limited by ref and path prefix.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          repo: {
            type: ['string', 'null'],
            description: 'GitHub repository in the form owner/name. If null, default repository is used.',
          },
          ref: {
            type: ['string', 'null'],
            description: 'Git ref to inspect: branch, tag, or commit SHA. If null, default branch is used.',
          },
          pathPrefix: {
            type: ['string', 'null'],
            description: 'Optional path prefix to limit the returned tree to a specific directory.',
          },
        },
        required: ['repo', 'ref', 'pathPrefix'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_list_files',
      description: 'List files in a repository directory, optionally for a specific ref.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: {
            type: ['string', 'null'],
            description: 'Directory path to list. If null, list from repository root.',
          },
          repo: {
            type: ['string', 'null'],
            description: 'GitHub repository in the form owner/name. If null, default repository is used.',
          },
          ref: {
            type: ['string', 'null'],
            description: 'Git ref to inspect: branch, tag, or commit SHA. If null, default branch is used.',
          },
        },
        required: ['path', 'repo', 'ref'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_get_file',
      description: 'Get file contents from a repository path, optionally for a specific ref.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file inside the repository.',
          },
          repo: {
            type: ['string', 'null'],
            description: 'GitHub repository in the form owner/name. If null, default repository is used.',
          },
          ref: {
            type: ['string', 'null'],
            description: 'Git ref to inspect: branch, tag, or commit SHA. If null, default branch is used.',
          },
        },
        required: ['path', 'repo', 'ref'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_get_files_batch',
      description: 'Read multiple repository files in one call. Prefer this for audits and spec comparisons.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Repository file paths to read. Server validates 1..20 unique non-empty paths.',
          },
          repo: {
            type: ['string', 'null'],
            description: 'GitHub repository in the form owner/name. If null, default repository is used.',
          },
          ref: {
            type: ['string', 'null'],
            description: 'Git ref to inspect: branch, tag, or commit SHA. If null, default branch is used.',
          },
          maxCharsPerFile: {
            type: ['number', 'null'],
            description: 'Maximum number of characters to return per file.',
          },
          maxTotalChars: {
            type: ['number', 'null'],
            description: 'Maximum total characters to return across all files in the batch.',
          },
        },
        required: ['paths', 'repo', 'ref', 'maxCharsPerFile', 'maxTotalChars'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_search_in_repo',
      description: 'Search code or text in a repository, optionally limited by path and pagination.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: {
            type: 'string',
            description: 'Search query text.',
          },
          path: {
            type: ['string', 'null'],
            description: 'Optional path prefix to limit search to a directory.',
          },
          repo: {
            type: ['string', 'null'],
            description: 'GitHub repository in the form owner/name. If null, default repository is used.',
          },
          per_page: {
            type: ['number', 'null'],
            description: 'Number of results per page.',
          },
          page: {
            type: ['number', 'null'],
            description: 'Page number for paginated results.',
          },
        },
        required: ['query', 'path', 'repo', 'per_page', 'page'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_self_check_search_schema',
      description:
        'Self-check: inspect GitHub GraphQL SearchType enum values to verify whether CODE search is supported.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_create_pull_request',
      description: 'Create a GitHub pull request.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', description: 'Pull request title.' },
          head: { type: 'string', description: 'Source branch name.' },
          base: { type: ['string', 'null'], description: 'Target branch name. If null, repository default is used.' },
          body: { type: ['string', 'null'], description: 'Pull request body in markdown.' },
          repo: {
            type: ['string', 'null'],
            description: 'GitHub repository in the form owner/name. If null, default repository is used.',
          },
        },
        required: ['title', 'head', 'base', 'body', 'repo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_merge_pull_request',
      description: 'Merge a GitHub pull request.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pull_number: { type: 'number', description: 'Pull request number.' },
          method: {
            type: ['string', 'null'],
            enum: ['merge', 'squash', 'rebase', null],
            description: 'Merge method. If null, server-side default is used.',
          },
          repo: {
            type: ['string', 'null'],
            description: 'GitHub repository in the form owner/name. If null, default repository is used.',
          },
        },
        required: ['pull_number', 'method', 'repo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_create_issue',
      description: 'Create a GitHub issue.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', description: 'Issue title.' },
          body: { type: ['string', 'null'], description: 'Issue body in markdown.' },
          labels: { type: ['array', 'null'], items: { type: 'string' }, description: 'List of labels to apply.' },
          assignees: {
            type: ['array', 'null'],
            items: { type: 'string' },
            description: 'List of GitHub usernames to assign.',
          },
          repo: {
            type: ['string', 'null'],
            description: 'GitHub repository in the form owner/name. If null, default repository is used.',
          },
        },
        required: ['title', 'body', 'labels', 'assignees', 'repo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_update_issue',
      description: 'Update an existing GitHub issue.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          issue_number: { type: 'number', description: 'Issue number.' },
          title: { type: ['string', 'null'], description: 'New issue title.' },
          body: { type: ['string', 'null'], description: 'New issue body in markdown.' },
          state: {
            type: ['string', 'null'],
            enum: ['open', 'closed', null],
            description: 'Issue state. If null, state is not changed.',
          },
          labels: { type: ['array', 'null'], items: { type: 'string' }, description: 'Full replacement label list.' },
          assignees: {
            type: ['array', 'null'],
            items: { type: 'string' },
            description: 'Full replacement assignee list.',
          },
          repo: {
            type: ['string', 'null'],
            description: 'GitHub repository in the form owner/name. If null, default repository is used.',
          },
        },
        required: ['issue_number', 'title', 'body', 'state', 'labels', 'assignees', 'repo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_list_issues',
      description: 'List GitHub issues with optional state and label filters.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          state: {
            type: ['string', 'null'],
            enum: ['open', 'closed', 'all', null],
            description: 'Issue state filter.',
          },
          labels: { type: ['array', 'null'], items: { type: 'string' }, description: 'Labels that issues must match.' },
          repo: {
            type: ['string', 'null'],
            description: 'GitHub repository in the form owner/name. If null, default repository is used.',
          },
        },
        required: ['state', 'labels', 'repo'],
      },
    },
  },

  // Git write tools
  {
    type: 'function',
    function: {
      name: 'github_create_branch',
      description: 'Create a new branch in a GitHub repository.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          branch: {
            type: 'string',
            description: 'Name of the new branch to create.',
          },
          base: {
            type: ['string', 'null'],
            description: 'Base branch or ref to create the new branch from. If null, handler default is used.',
          },
          repo: {
            type: ['string', 'null'],
            description: 'GitHub repository in the form owner/name. If null, default repository is used.',
          },
        },
        required: ['branch', 'base', 'repo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_commit_file',
      description: 'Create or update a file in a GitHub repository and commit the change.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file inside the repository.',
          },
          content: {
            type: 'string',
            description: 'Full file content to write.',
          },
          message: { type: 'string', description: 'Commit message.' },
          branch: {
            type: 'string',
            description: 'Branch name where the commit will be created.',
          },
          repo: {
            type: ['string', 'null'],
            description: 'GitHub repository in the form owner/name. If null, default repository is used.',
          },
        },
        required: ['path', 'content', 'message', 'branch', 'repo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_delete_file',
      description: 'Delete a file from a GitHub repository and commit the deletion.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file inside the repository.',
          },
          message: { type: 'string', description: 'Commit message.' },
          branch: {
            type: 'string',
            description: 'Branch name where the deletion commit will be created.',
          },
          repo: {
            type: ['string', 'null'],
            description: 'GitHub repository in the form owner/name. If null, default repository is used.',
          },
        },
        required: ['path', 'message', 'branch', 'repo'],
      },
    },
  },

  // Actions
  {
    type: 'function',
    function: {
      name: 'github_list_workflow_runs',
      description: 'List GitHub Actions workflow runs.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          workflow_id: { type: ['string', 'null'], description: 'Workflow file name or workflow id.' },
          repo: {
            type: ['string', 'null'],
            description: 'GitHub repository in the form owner/name. If null, default repository is used.',
          },
          ref: { type: ['string', 'null'], description: 'Optional git ref filter.' },
          per_page: { type: ['number', 'null'], description: 'Number of runs to return.' },
        },
        required: ['workflow_id', 'repo', 'ref', 'per_page'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_list_workflow_run_jobs',
      description: 'List jobs for a GitHub Actions workflow run.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          run_id: { type: 'number', description: 'Workflow run id.' },
          repo: {
            type: ['string', 'null'],
            description: 'GitHub repository in the form owner/name. If null, default repository is used.',
          },
        },
        required: ['run_id', 'repo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_download_workflow_run_logs',
      description: 'Download raw logs archive for a GitHub Actions workflow run.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          run_id: { type: 'number', description: 'Workflow run id.' },
          repo: {
            type: ['string', 'null'],
            description: 'GitHub repository in the form owner/name. If null, default repository is used.',
          },
        },
        required: ['run_id', 'repo'],
      },
    },
  },

  // Diagnostics (Stage 1)
  {
    type: 'function',
    function: {
      name: 'github_get_workflow_run_logs_text',
      description: 'Get workflow run logs converted to text, optionally truncated.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          run_id: { type: 'number', description: 'Workflow run id.' },
          repo: {
            type: ['string', 'null'],
            description: 'GitHub repository in the form owner/name. If null, default repository is used.',
          },
          maxChars: { type: ['number', 'null'], description: 'Maximum number of characters to return.' },
        },
        required: ['run_id', 'repo', 'maxChars'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_diagnose_workflow_run',
      description: 'Diagnose a specific GitHub Actions workflow run.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          run_id: { type: 'number', description: 'Workflow run id.' },
          repo: {
            type: ['string', 'null'],
            description: 'GitHub repository in the form owner/name. If null, default repository is used.',
          },
          maxChars: { type: ['number', 'null'], description: 'Maximum log text length to use in diagnosis.' },
        },
        required: ['run_id', 'repo', 'maxChars'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_diagnose_latest_workflow_run',
      description: 'Diagnose the latest GitHub Actions workflow run that matches filters.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          repo: {
            type: ['string', 'null'],
            description: 'GitHub repository in the form owner/name. If null, default repository is used.',
          },
          workflow_id: { type: ['string', 'null'], description: 'Workflow file name or workflow id.' },
          ref: { type: ['string', 'null'], description: 'Optional git ref filter.' },
          per_page: { type: ['number', 'null'], description: 'How many recent runs to inspect.' },
          maxChars: { type: ['number', 'null'], description: 'Maximum log text length to use in diagnosis.' },
        },
        required: ['repo', 'workflow_id', 'ref', 'per_page', 'maxChars'],
      },
    },
  },

  // Diagnostics (Stage 2)
  {
    type: 'function',
    function: {
      name: 'github_diagnose_actions_setup',
      description: 'Diagnose GitHub Actions setup problems in a repository.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          repo: {
            type: ['string', 'null'],
            description: 'GitHub repository in the form owner/name. If null, default repository is used.',
          },
          ref: { type: ['string', 'null'], description: 'Git ref to inspect: branch, tag, or commit SHA.' },
          workflow_id: { type: ['string', 'null'], description: 'Workflow file name or workflow id to inspect.' },
        },
        required: ['repo', 'ref', 'workflow_id'],
      },
    },
  },
] as const;

type ListFilesArgs = { path?: string; repo?: string; ref?: string };

type SearchArgs = {
  query: string;
  path?: string;
  repo?: string;
  per_page?: number;
  page?: number;
};

type GetFilesBatchArgs = {
  paths: string[];
  repo?: string;
  ref?: string;
  maxCharsPerFile?: number;
  maxTotalChars?: number;
};

function buildOptional<T extends Record<string, unknown>>(obj: T): {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as any;
}

/**
 * Handlers.
 */
export const githubToolHandlers = {
  async github_get_repo_structure(args: {
    repo?: string;
    ref?: string;
    pathPrefix?: string;
  }) {
    return getRepoStructure(
      buildOptional({
        repo: args.repo,
        ref: args.ref,
        pathPrefix: args.pathPrefix,
      }),
    );
  },

  async github_list_files(args: ListFilesArgs) {
    const options: { path?: string; repo?: string; ref?: string } = {};
    if (args.path !== undefined) options.path = args.path;
    if (args.repo !== undefined) options.repo = args.repo;
    if (args.ref !== undefined) options.ref = args.ref;
    return listFiles(options);
  },

  async github_get_file(args: { path: string; repo?: string; ref?: string }) {
    return getFile(args.path, args.repo, args.ref);
  },

  async github_get_files_batch(args: GetFilesBatchArgs) {
    return getFilesBatch(
      buildOptional({
        paths: args.paths,
        repo: args.repo,
        ref: args.ref,
        maxCharsPerFile: args.maxCharsPerFile,
        maxTotalChars: args.maxTotalChars,
      }),
    );
  },

  async github_search_in_repo(args: SearchArgs) {
    const options: {
      query: string;
      path?: string;
      repo?: string;
      per_page?: number;
      page?: number;
    } = { query: args.query };

    if (args.path !== undefined) options.path = args.path;
    if (args.repo !== undefined) options.repo = args.repo;
    if (args.per_page !== undefined) options.per_page = args.per_page;
    if (args.page !== undefined) options.page = args.page;

    return searchInRepo(options);
  },

  async github_self_check_search_schema() {
    const octokit = getGithubClient();

    const query = `query SearchTypeIntrospection { __type(name: "SearchType") { enumValues { name } } }`;
    const res: any = await octokit.graphql(query);
    const values = res?.__type?.enumValues ?? [];

    return {
      ok: true,
      searchTypeEnumValues: values.map((v: any) => v.name),
    };
  },

  async github_create_pull_request(args: {
    title: string;
    head: string;
    base?: string;
    body?: string;
    repo?: string;
  }) {
    const options: {
      title: string;
      head: string;
      base?: string;
      body?: string;
      repo?: string;
    } = {
      title: args.title,
      head: args.head,
    };

    if (args.base !== undefined) options.base = args.base;
    if (args.body !== undefined) options.body = args.body;
    if (args.repo !== undefined) options.repo = args.repo;

    return createPullRequest(options);
  },

  async github_merge_pull_request(args: {
    pull_number: number;
    method?: 'merge' | 'squash' | 'rebase';
    repo?: string;
  }) {
    const options: {
      pull_number: number;
      method?: 'merge' | 'squash' | 'rebase';
      repo?: string;
    } = { pull_number: args.pull_number };

    if (args.method !== undefined) options.method = args.method;
    if (args.repo !== undefined) options.repo = args.repo;

    return mergePullRequest(options);
  },

  async github_create_issue(args: {
    title: string;
    body?: string;
    labels?: string[];
    assignees?: string[];
    repo?: string;
  }) {
    const options: {
      title: string;
      body?: string;
      labels?: string[];
      assignees?: string[];
      repo?: string;
    } = { title: args.title };

    if (args.body !== undefined) options.body = args.body;
    if (args.labels !== undefined) options.labels = args.labels;
    if (args.assignees !== undefined) options.assignees = args.assignees;
    if (args.repo !== undefined) options.repo = args.repo;

    return createIssue(options);
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
    const options: {
      issue_number: number;
      title?: string;
      body?: string;
      state?: 'open' | 'closed';
      labels?: string[];
      assignees?: string[];
      repo?: string;
    } = { issue_number: args.issue_number };

    if (args.title !== undefined) options.title = args.title;
    if (args.body !== undefined) options.body = args.body;
    if (args.state !== undefined) options.state = args.state;
    if (args.labels !== undefined) options.labels = args.labels;
    if (args.assignees !== undefined) options.assignees = args.assignees;
    if (args.repo !== undefined) options.repo = args.repo;

    return updateIssue(options);
  },

  async github_list_issues(args: {
    state?: 'open' | 'closed' | 'all';
    labels?: string[];
    repo?: string;
  }) {
    const options: {
      state?: 'open' | 'closed' | 'all';
      labels?: string[];
      repo?: string;
    } = {};

    if (args.state !== undefined) options.state = args.state;
    if (args.labels !== undefined) options.labels = args.labels;
    if (args.repo !== undefined) options.repo = args.repo;

    return listIssues(options);
  },

  async github_list_workflow_runs(args: {
    workflow_id?: string;
    repo?: string;
    ref?: string;
    per_page?: number;
  }) {
    return listWorkflowRuns(
      buildOptional({
        workflow_id: args.workflow_id,
        repo: args.repo,
        ref: args.ref,
        per_page: args.per_page,
      }),
    );
  },

  async github_list_workflow_run_jobs(args: { run_id: number; repo?: string }) {
    return listWorkflowRunJobs(
      args.repo ? { run_id: args.run_id, repo: args.repo } : { run_id: args.run_id },
    );
  },

  async github_download_workflow_run_logs(args: { run_id: number; repo?: string }) {
    return downloadWorkflowRunLogs(
      args.repo ? { run_id: args.run_id, repo: args.repo } : { run_id: args.run_id },
    );
  },

  async github_get_workflow_run_logs_text(args: {
    run_id: number;
    repo?: string;
    maxChars?: number;
  }) {
    return githubGetWorkflowRunLogsText(
      buildOptional({
        run_id: args.run_id,
        repo: args.repo,
        maxChars: args.maxChars,
      }),
    );
  },

  async github_diagnose_workflow_run(args: {
    run_id: number;
    repo?: string;
    maxChars?: number;
  }) {
    return githubDiagnoseWorkflowRun(
      buildOptional({
        run_id: args.run_id,
        repo: args.repo,
        maxChars: args.maxChars,
      }),
    );
  },

  async github_diagnose_latest_workflow_run(args: {
    repo?: string;
    workflow_id?: string;
    ref?: string;
    per_page?: number;
    maxChars?: number;
  }) {
    return githubDiagnoseLatestWorkflowRun(
      buildOptional({
        repo: args.repo,
        workflow_id: args.workflow_id,
        ref: args.ref,
        per_page: args.per_page,
        maxChars: args.maxChars,
      }),
    );
  },

  async github_diagnose_actions_setup(args: {
    repo?: string;
    ref?: string;
    workflow_id?: string;
  }) {
    return githubDiagnoseActionsSetup(args);
  },

  async github_create_branch(args: { branch: string; base?: string; repo?: string }) {
    return createBranch(args.branch, args.base ?? 'main', args.repo);
  },

  async github_commit_file(args: {
    path: string;
    content: string;
    message: string;
    branch: string;
    repo?: string;
  }) {
    return commitFile({
      path: args.path,
      content: args.content,
      message: args.message,
      branch: args.branch,
      ...(args.repo ? { repo: args.repo } : {}),
    });
  },

  async github_delete_file(args: {
    path: string;
    message: string;
    branch: string;
    repo?: string;
  }) {
    return deleteFile({
      path: args.path,
      message: args.message,
      branch: args.branch,
      ...(args.repo ? { repo: args.repo } : {}),
    });
  },
};
