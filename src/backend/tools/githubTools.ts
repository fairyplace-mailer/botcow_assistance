import {
  commitFile,
  createBranch,
  createIssue,
  createPullRequest,
  deleteFile,
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
      description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          repo: {
            type: 'string',
            description:
              'owner/name. \u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
          },
          ref: {
            type: 'string',
            description:
              '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
          },
          pathPrefix: {
            type: 'string',
            description:
              '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_list_files',
      description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000' },
          repo: {
            type: 'string',
            description:
              'owner/name. \u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
          },
          ref: {
            type: 'string',
            description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_get_file',
      description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000' },
          repo: {
            type: 'string',
            description:
              'owner/name. \u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
          },
          ref: {
            type: 'string',
            description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
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
      description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000' },
          path: { type: 'string', description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000' },
          repo: {
            type: 'string',
            description:
              'owner/name. \u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
          },
          per_page: {
            type: 'number',
            description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
          },
          page: {
            type: 'number',
            description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_self_check_search_schema',
      description:
        'Self-check: GitHub GraphQL introspection for SearchType enum values. Helps verify whether CODE is supported in schema.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_create_pull_request',
      description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
      parameters: {
        type: 'object',
        additionalProperties: false,
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
      description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
      parameters: {
        type: 'object',
        additionalProperties: false,
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
      description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
      parameters: {
        type: 'object',
        additionalProperties: false,
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
      description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
      parameters: {
        type: 'object',
        additionalProperties: false,
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
      description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          state: { type: 'string', enum: ['open', 'closed', 'all'] },
          labels: { type: 'array', items: { type: 'string' } },
          repo: { type: 'string' },
        },
      },
    },
  },

  // Git write tools
  {
    type: 'function',
    function: {
      name: 'github_create_branch',
      description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          branch: { type: 'string', description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000' },
          base: {
            type: 'string',
            description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
          },
          repo: {
            type: 'string',
            description:
              'owner/name. \u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
          },
        },
        required: ['branch'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_commit_file',
      description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000' },
          content: {
            type: 'string',
            description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
          },
          message: { type: 'string', description: 'Commit message.' },
          branch: { type: 'string', description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000' },
          repo: {
            type: 'string',
            description:
              'owner/name. \u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
          },
        },
        required: ['path', 'content', 'message', 'branch'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_delete_file',
      description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000' },
          message: { type: 'string', description: 'Commit message.' },
          branch: { type: 'string', description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000' },
          repo: {
            type: 'string',
            description:
              'owner/name. \u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
          },
        },
        required: ['path', 'message', 'branch'],
      },
    },
  },

  // Actions
  {
    type: 'function',
    function: {
      name: 'github_list_workflow_runs',
      description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          workflow_id: { type: 'string' },
          repo: { type: 'string' },
          ref: { type: 'string' },
          per_page: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_list_workflow_run_jobs',
      description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
      parameters: {
        type: 'object',
        additionalProperties: false,
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
      description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
      parameters: {
        type: 'object',
        additionalProperties: false,
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
        '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
      parameters: {
        type: 'object',
        additionalProperties: false,
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
      description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
      parameters: {
        type: 'object',
        additionalProperties: false,
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
      name: 'github_diagnose_latest_workflow_run',
      description:
        '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          repo: { type: 'string' },
          workflow_id: { type: 'string' },
          ref: { type: 'string' },
          per_page: { type: 'number' },
          maxChars: { type: 'number' },
        },
      },
    },
  },

  // Diagnostics (Stage 2)
  {
    type: 'function',
    function: {
      name: 'github_diagnose_actions_setup',
      description: '\u000f\u0000\u000b\u0000\u0003\u0000\u0003\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          repo: { type: 'string' },
          ref: { type: 'string' },
          workflow_id: { type: 'string' },
        },
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
