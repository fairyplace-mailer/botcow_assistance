import {
  getFile,
  getRepoStructure,
  listFiles,
  searchInRepo,
  getRecentCommits,
  createBranch,
  commitFile,
  deleteFile,
  createPullRequest,
  commentOnPullRequest,
  mergePullRequest,
  runWorkflow,
  getWorkflowStatus,
  createIssue,
  updateIssue,
  listIssues,
  listWorkflowRunsForRepo,
  listWorkflowRunJobs,
  downloadWorkflowRunLogs,
} from './github';

/**
 * СХЕМЫ (описание tools для OpenAI).
 */
export const toolSchemas = [
  {
    type: 'function',
    function: {
      name: 'github_get_file',
      description: 'Прочитать файл по пути из репозитория.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          repo: { type: 'string', nullable: true },
          ref: { type: 'string', nullable: true },
        },
        required: ['path'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'github_get_repo_structure',
      description: 'Получить структуру репозитория (дерево файлов).',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', nullable: true },
          ref: { type: 'string', nullable: true },
          pathPrefix: { type: 'string', nullable: true },
        },
        required: [],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'github_list_files',
      description: 'Список файлов/папок по пути (один уровень).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', nullable: true },
          repo: { type: 'string', nullable: true },
          ref: { type: 'string', nullable: true },
        },
        required: [],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'github_search_in_repo',
      description: 'Поиск по репозиторию.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          path: { type: 'string', nullable: true },
          repo: { type: 'string', nullable: true },
          per_page: { type: 'number', nullable: true },
        },
        required: ['query'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'github_get_recent_commits',
      description: 'Последние коммиты по ветке.',
      parameters: {
        type: 'object',
        properties: {
          branch: { type: 'string', nullable: true },
          limit: { type: 'number', nullable: true },
          repo: { type: 'string', nullable: true },
        },
        required: [],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'github_create_branch',
      description: 'Создать ветку от базовой ветки.',
      parameters: {
        type: 'object',
        properties: {
          branchName: { type: 'string' },
          baseBranch: { type: 'string', nullable: true },
          repo: { type: 'string', nullable: true },
        },
        required: ['branchName'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'github_commit_file',
      description: 'Создать или обновить файл.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
          message: { type: 'string' },
          branch: { type: 'string' },
          repo: { type: 'string', nullable: true },
        },
        required: ['path', 'content', 'message', 'branch'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'github_delete_file',
      description: 'Удалить файл в ветке.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          message: { type: 'string' },
          branch: { type: 'string' },
          repo: { type: 'string', nullable: true },
        },
        required: ['path', 'message', 'branch'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'github_create_pull_request',
      description: 'Создать Pull Request.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          head: { type: 'string' },
          base: { type: 'string', nullable: true },
          body: { type: 'string', nullable: true },
          repo: { type: 'string', nullable: true },
        },
        required: ['title', 'head'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'github_comment_on_pr',
      description: 'Оставить комментарий в PR.',
      parameters: {
        type: 'object',
        properties: {
          pull_number: { type: 'number' },
          body: { type: 'string' },
          repo: { type: 'string', nullable: true },
        },
        required: ['pull_number', 'body'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'github_merge_pull_request',
      description: 'Замёржить Pull Request выбранным методом.',
      parameters: {
        type: 'object',
        properties: {
          pull_number: { type: 'number' },
          method: {
            type: 'string',
            enum: ['merge', 'squash', 'rebase'],
            nullable: true,
          },
          repo: { type: 'string', nullable: true },
        },
        required: ['pull_number'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'github_run_workflow',
      description: 'Запустить workflow GitHub Actions.',
      parameters: {
        type: 'object',
        properties: {
          workflow_id: { type: 'string', nullable: true },
          ref: { type: 'string', nullable: true },
          repo: { type: 'string', nullable: true },
          inputs: { type: 'object', nullable: true },
        },
        required: [],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'github_list_workflow_runs',
      description:
        'Получить список запусков GitHub Actions workflow для репозитория.',
      parameters: {
        type: 'object',
        properties: {
          workflow_id: { type: 'string', nullable: true },
          ref: { type: 'string', nullable: true },
          repo: { type: 'string', nullable: true },
          per_page: { type: 'number', nullable: true },
        },
        required: [],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'github_get_workflow_status',
      description: 'Получить статус workflow.',
      parameters: {
        type: 'object',
        properties: {
          run_id: { type: 'number' },
          repo: { type: 'string', nullable: true },
        },
        required: ['run_id'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'github_list_workflow_run_jobs',
      description: 'Получить список jobs для workflow run.',
      parameters: {
        type: 'object',
        properties: {
          run_id: { type: 'number' },
          repo: { type: 'string', nullable: true },
        },
        required: ['run_id'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'github_download_workflow_run_logs',
      description:
        'Скачать логи workflow run. Возвращает zip в base64 (формат zip-base64).',
      parameters: {
        type: 'object',
        properties: {
          run_id: { type: 'number' },
          repo: { type: 'string', nullable: true },
        },
        required: ['run_id'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'github_create_issue',
      description: 'Создать Issue.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          body: { type: 'string', nullable: true },
          labels: { type: 'array', items: { type: 'string' }, nullable: true },
          assignees: {
            type: 'array',
            items: { type: 'string' },
            nullable: true,
          },
          repo: { type: 'string', nullable: true },
        },
        required: ['title'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'github_update_issue',
      description: 'Обновить Issue.',
      parameters: {
        type: 'object',
        properties: {
          issue_number: { type: 'number' },
          title: { type: 'string', nullable: true },
          body: { type: 'string', nullable: true },
          state: {
            type: 'string',
            enum: ['open', 'closed'],
            nullable: true,
          },
          labels: { type: 'array', items: { type: 'string' }, nullable: true },
          assignees: {
            type: 'array',
            items: { type: 'string' },
            nullable: true,
          },
          repo: { type: 'string', nullable: true },
        },
        required: ['issue_number'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'github_list_issues',
      description: 'Получить список Issues по фильтрам.',
      parameters: {
        type: 'object',
        properties: {
          state: {
            type: 'string',
            enum: ['open', 'closed', 'all'],
            nullable: true,
          },
          labels: {
            type: 'array',
            items: { type: 'string' },
            nullable: true,
          },
          repo: { type: 'string', nullable: true },
          per_page: { type: 'number', nullable: true },
        },
        required: [],
      },
    },
  },
];

/**
 * HANDLERS (реализация tools).
 */
export const toolHandlers = {
  github_get_file: async (args: any) => {
    return await getFile(args.path, args.repo, args.ref);
  },

  github_get_repo_structure: async (args: any) => {
    return await getRepoStructure(args);
  },

  github_list_files: async (args: any) => {
    return await listFiles(args);
  },

  github_search_in_repo: async (args: any) => {
    return await searchInRepo(args);
  },

  github_get_recent_commits: async (args: any) => {
    return await getRecentCommits(args);
  },

  github_create_branch: async (args: any) => {
    return await createBranch(args.branchName, args.baseBranch, args.repo);
  },

  github_commit_file: async (args: any) => {
    return await commitFile(args);
  },

  github_delete_file: async (args: any) => {
    return await deleteFile(args);
  },

  github_create_pull_request: async (args: any) => {
    return await createPullRequest(args);
  },

  github_comment_on_pr: async (args: any) => {
    return await commentOnPullRequest(args);
  },

  github_merge_pull_request: async (args: any) => {
    return await mergePullRequest(args);
  },

  github_run_workflow: async (args: any) => {
    return await runWorkflow(args);
  },

  github_list_workflow_runs: async (args: any) => {
    return await listWorkflowRunsForRepo(args);
  },

  github_get_workflow_status: async (args: any) => {
    return await getWorkflowStatus(args);
  },

  github_list_workflow_run_jobs: async (args: any) => {
    return await listWorkflowRunJobs(args);
  },

  github_download_workflow_run_logs: async (args: any) => {
    return await downloadWorkflowRunLogs(args);
  },

  github_create_issue: async (args: any) => {
    return await createIssue(args);
  },

  github_update_issue: async (args: any) => {
    return await updateIssue(args);
  },

  github_list_issues: async (args: any) => {
    return await listIssues(args);
  },
};
