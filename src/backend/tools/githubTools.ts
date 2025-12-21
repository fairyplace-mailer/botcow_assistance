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
      description: 'Получить структуру репозитория (GitHub).',
      parameters: {
        type: 'object',
        properties: {
          repo: {
            type: 'string',
            description:
              'owner/name. Если не задано — используется дефолтный репозиторий.',
          },
          ref: {
            type: 'string',
            description:
              'Ветка/тег/sha. Если не задано — default branch (внутри инструмента).',
          },
          pathPrefix: {
            type: 'string',
            description:
              'Фильтр по префиксу пути (например, "src/backend").',
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
              'owner/name. Если не задано — используется дефолтный репозиторий.',
          },
          ref: {
            type: 'string',
            description: 'Ветка/тег/sha. Если не задано — default branch.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_get_file',
      description: 'Получить содержимое файла.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Путь внутри репозитория.' },
          repo: {
            type: 'string',
            description:
              'owner/name. Если не задано — используется дефолтный репозиторий.',
          },
          ref: {
            type: 'string',
            description: 'Ветка/тег/sha. Если не задано — default branch.',
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
          query: { type: 'string', description: 'Поисковая строка.' },
          path: { type: 'string', description: 'Ограничить поиск директорией.' },
          repo: {
            type: 'string',
            description:
              'owner/name. Если не задано — используется дефолтный репозиторий.',
          },
          per_page: { type: 'number', description: 'Кол-во (до 100).' },
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
      description: 'Смержить Pull Request выбранным методом.',
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
      description: 'Список Issues по фильтрам.',
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

  // Git write tools
  {
    type: 'function',
    function: {
      name: 'github_create_branch',
      description: 'Создать ветку от baseBranch.',
      parameters: {
        type: 'object',
        properties: {
          branch: { type: 'string', description: 'Имя новой ветки.' },
          base: {
            type: 'string',
            description: 'Базовая ветка. По умолчанию: main.',
          },
          repo: {
            type: 'string',
            description:
              'owner/name. Если не задано — используется дефолтный репозиторий.',
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
      description: 'Создать или обновить файл (commit) в указанной ветке.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Путь файла в репозитории.' },
          content: {
            type: 'string',
            description: 'Полное содержимое файла (utf-8).',
          },
          message: { type: 'string', description: 'Commit message.' },
          branch: { type: 'string', description: 'Ветка, в которую коммитим.' },
          repo: {
            type: 'string',
            description:
              'owner/name. Если не задано — используется дефолтный репозиторий.',
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
      description: 'Удалить файл в указанной ветке.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Путь файла в репозитории.' },
          message: { type: 'string', description: 'Commit message.' },
          branch: { type: 'string', description: 'Ветка, из которой удаляем.' },
          repo: {
            type: 'string',
            description:
              'owner/name. Если не задано — используется дефолтный репозиторий.',
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
      description: 'Получить список GitHub Actions workflow runs.',
      parameters: {
        type: 'object',
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
      description: 'Получить список jobs по workflow run id.',
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
      description: 'Скачать логи workflow run (zip base64).',
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
      description: 'Достать логи workflow run как текст (распаковка zip).',
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
        'Диагностика CI по workflow run: failed jobs + ключевые строки ошибок из логов.',
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
      name: 'github_diagnose_latest_workflow_run',
      description:
        'Диагностика последнего workflow run (logs + failed jobs).',
      parameters: {
        type: 'object',
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
      description:
        'Косвенная диагностика GitHub Actions (почему нет ран-ов, 403, permissions). Возвращает чеклист и подсказки.',
      parameters: {
        type: 'object',
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
