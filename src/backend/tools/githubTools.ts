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

/**
 * JSON-схемы tools для OpenAI (function calling).
 * Должны экспортироваться как githubToolsSchemas, чтобы tools/index.ts мог собрать общий список.
 */
export const githubToolsSchemas = [
  {
    type: 'function',
    function: {
      name: 'github_get_repo_structure',
      description: 'Получить дерево файлов репозитория (GitHub).',
      parameters: {
        type: 'object',
        properties: {
          repo: {
            type: 'string',
            description:
              'Репозиторий в формате owner/name. Если не указан — используется BOTCOW_DEFAULT_REPO.',
          },
        },
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
          path: { type: 'string', description: 'Путь внутри репозитория.' },
          repo: {
            type: 'string',
            description:
              'Репозиторий owner/name. Если не указан — BOTCOW_DEFAULT_REPO.',
          },
          ref: {
            type: 'string',
            description: 'Ветка/тег/sha. Если не указан — default branch.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_get_file',
      description: 'Прочитать файл по пути из репозитория.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Путь файла внутри репозитория.' },
          repo: {
            type: 'string',
            description:
              'Репозиторий owner/name. Если не указан — BOTCOW_DEFAULT_REPO.',
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
      description: 'Поиск по репозиторию.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Поисковый запрос.' },
          path: { type: 'string', description: 'Ограничить поиск путём.' },
          repo: {
            type: 'string',
            description:
              'Репозиторий owner/name. Если не указан — BOTCOW_DEFAULT_REPO.',
          },
          per_page: { type: 'number', description: 'Кол-во результатов (до 100).' },
        },
        required: ['query'],
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
      description: 'Замёржить Pull Request выбранным методом.',
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
      description: 'Создать Issue.',
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
      description: 'Обновить Issue.',
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
      description: 'Получить список Issues по фильтрам.',
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
  {
    type: 'function',
    function: {
      name: 'github_list_workflow_runs',
      description: 'Получить список запусков GitHub Actions workflow для репозитория.',
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
      description: 'Получить список jobs для конкретного workflow run.',
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
      description: 'Скачать и распаковать логи workflow run.',
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
] as const;

type ListFilesArgs = { path?: string; repo?: string; ref?: string };

type SearchArgs = {
  query: string;
  path?: string;
  repo?: string;
  per_page?: number;
};

/**
 * Хендлеры tools — дергаются роутером tools.
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
};
