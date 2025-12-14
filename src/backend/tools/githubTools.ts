import {
  createIssue,
  createPullRequest,
  downloadWorkflowRunLogs,
  getFile,
  getRepoStructure,
  listFiles,
  listIssues,
  listWorkflowRunJobs,
  listWorkflowRuns,
  mergePullRequest,
  searchInRepo,
  updateIssue,
} from '../github';
import {
  githubDiagnoseLatestWorkflowRun,
  githubDiagnoseWorkflowRun,
  githubGetWorkflowRunLogsText,
} from '../ciDiagnostics';

/**
 * JSON- schemas tools  for OpenAI (function calling).
 */
export const githubToolsSchemas = [
  {
    type: 'function',
    function: {
      name: 'github_get_repo_structure',
      description: '     (GitHub).',
      parameters: {
        type: 'object',
        properties: {
          repo: {
            type: 'string',
            description: 'owner/name.     BOTCOW_DEFAULT_REPO.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_list_files',
      description: ' /   ( ).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '  .' },
          repo: {
            type: 'string',
            description: 'owner/name.     BOTCOW_DEFAULT_REPO.',
          },
          ref: {
            type: 'string',
            description: '//sha.     default branch.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_get_file',
      description: '      .',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '  .' },
          repo: {
            type: 'string',
            description: 'owner/name.     BOTCOW_DEFAULT_REPO.',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_search_in_repo',
      description: '  .',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: ' .' },
          path: { type: 'string', description: '  .' },
          repo: {
            type: 'string',
            description: 'owner/name.     BOTCOW_DEFAULT_REPO.',
          },
          per_page: { type: 'number', description: '- ( 100).' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_create_pull_request',
      description: ' Pull Request.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          head: { type: 'string' },
          base: { type: 'string' },
          body: { type: 'string' },
          repo: { type: 'string' },
        },
        required: ['title', 'head'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_merge_pull_request',
      description: ' Pull Request  .',
      parameters: {
        type: 'object',
        properties: {
          pull_number: { type: 'number' },
          method: { type: 'string', enum: ['merge', 'squash', 'rebase'] },
          repo: { type: 'string' },
        },
        required: ['pull_number'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_create_issue',
      description: ' Issue.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          body: { type: 'string' },
          labels: { type: 'array', items: { type: 'string' } },
          assignees: { type: 'array', items: { type: 'string' } },
          repo: { type: 'string' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_update_issue',
      description: ' Issue.',
      parameters: {
        type: 'object',
        properties: {
          issue_number: { type: 'number' },
          title: { type: 'string' },
          body: { type: 'string' },
          state: { type: 'string', enum: ['open', 'closed'] },
          labels: { type: 'array', items: { type: 'string' } },
          assignees: { type: 'array', items: { type: 'string' } },
          repo: { type: 'string' },
        },
        required: ['issue_number'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_list_issues',
      description: '  Issues  .',
      parameters: {
        type: 'object',
        properties: {
          state: { type: 'string', enum: ['open', 'closed', 'all'] },
          labels: { type: 'array', items: { type: 'string' } },
          repo: { type: 'string' },
        },
      },
    },
  },

  // Actions
  {
    type: 'function',
    function: {
      name: 'github_list_workflow_runs',
      description: '   GitHub Actions workflow  .',
      parameters: {
        type: 'object',
        properties: {
          workflow_id: { type: 'string' },
          repo: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_list_workflow_run_jobs',
      description: '  jobs  workflow run.',
      parameters: {
        type: 'object',
        properties: {
          run_id: { type: 'number' },
          repo: { type: 'string' },
        },
        required: ['run_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_download_workflow_run_logs',
      description: '  workflow run (zip  base64).',
      parameters: {
        type: 'object',
        properties: {
          run_id: { type: 'number' },
          repo: { type: 'string' },
        },
        required: ['run_id'],
      },
    },
  },

  // Diagnostics (Stage 1)
  {
    type: 'function',
    function: {
      name: 'github_get_workflow_run_logs_text',
      description:
        '    workflow run.    (txt  zip).',
      parameters: {
        type: 'object',
        properties: {
          run_id: { type: 'number' },
          repo: { type: 'string' },
          maxChars: { type: 'number' },
        },
        required: ['run_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_diagnose_workflow_run',
      description:
        ' CI  workflow run:     +     .',
      parameters: {
        type: 'object',
        properties: {
          run_id: { type: 'number' },
          repo: { type: 'string' },
          maxChars: {
            type: 'number',
            description: '       .',
          },
          maxEvidence: {
            type: 'number',
            description: '    .',
          },
        },
        required: ['run_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_diagnose_latest_workflow_run',
      description:
        '   workflow run     (logs + failed jobs).',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string' },
          workflow_id: { type: 'string' },
          ref: { type: 'string' },
          per_page: { type: 'number' },
          maxChars: { type: 'number' },
          maxEvidence: { type: 'number' },
        },
        required: [],
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
};

/**
 * Handlers.
 */
export const githubToolHandlers = {
  async github_get_repo_structure(args: { repo?: string }) {
    return getRepoStructure(args.repo ? { repo: args.repo } : undefined);
  },

  async github_list_files(args: ListFilesArgs) {
    const options: { path?: string; repo?: string; ref?: string } = {};
    if (args.path !== undefined) options.path = args.path;
    if (args.repo !== undefined) options.repo = args.repo;
    if (args.ref !== undefined) options.ref = args.ref;
    return listFiles(options);
  },

  async github_get_file(args: { path: string; repo?: string }) {
    return getFile(args.path, args.repo);
  },

  async github_search_in_repo(args: SearchArgs) {
    const options: {
      query: string;
      path?: string;
      repo?: string;
      per_page?: number;
    } = { query: args.query };

    if (args.path !== undefined) options.path = args.path;
    if (args.repo !== undefined) options.repo = args.repo;
    if (args.per_page !== undefined) options.per_page = args.per_page;

    return searchInRepo(options);
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
    } = {
      pull_number: args.pull_number,
    };

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

  async github_list_workflow_runs(args: { workflow_id?: string; repo?: string }) {
    return listWorkflowRuns(
      args.repo
        ? { workflow_id: args.workflow_id, repo: args.repo }
        : { workflow_id: args.workflow_id },
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
    return githubGetWorkflowRunLogsText({
      run_id: args.run_id,
      repo: args.repo,
      maxChars: args.maxChars,
    });
  },

  async github_diagnose_workflow_run(args: {
    run_id: number;
    repo?: string;
    maxChars?: number;
    maxEvidence?: number;
  }) {
    return githubDiagnoseWorkflowRun({
      run_id: args.run_id,
      repo: args.repo,
      maxChars: args.maxChars,
      maxEvidence: args.maxEvidence,
    });
  },

  async github_diagnose_latest_workflow_run(args: {
    repo?: string;
    workflow_id?: string;
    ref?: string;
    per_page?: number;
    maxChars?: number;
    maxEvidence?: number;
  }) {
    return githubDiagnoseLatestWorkflowRun({
      repo: args.repo,
      workflow_id: args.workflow_id,
      ref: args.ref,
      per_page: args.per_page,
      maxChars: args.maxChars,
      maxEvidence: args.maxEvidence,
    });
  },
};
