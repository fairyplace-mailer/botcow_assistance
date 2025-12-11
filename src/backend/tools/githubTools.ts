import {
  getFile,
  createBranch,
  commitFile,
  createPullRequest,
  mergePullRequest,
  runWorkflow,
  getWorkflowStatus,
  commentOnPullRequest,
  listWorkflowRuns,
} from '../github';

export const githubToolsSchemas = [
  {
    type: 'function',
    function: {
      name: 'github_get_file',
      description:
        'Прочитать файл из репозитория по пути (используется по умолчанию BOTCOW_DEFAULT_REPO).',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Путь к файлу в репо, например "src/app/page.tsx".',
          },
          repo: {
            type: 'string',
            description:
              'Полное имя репозитория "owner/repo". Если не указано, используется BOTCOW_DEFAULT_REPO.',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_create_branch',
      description:
        'Создать новую ветку от базовой (по умолчанию main) в указанном репозитории.',
      parameters: {
        type: 'object',
        properties: {
          branchName: {
            type: 'string',
            description: 'Имя новой ветки.',
          },
          baseBranch: {
            type: 'string',
            description: 'Базовая ветка, по умолчанию main.',
          },
          repo: {
            type: 'string',
            description:
              'Репозиторий owner/repo, по умолчанию BOTCOW_DEFAULT_REPO.',
          },
        },
        required: ['branchName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_commit_file',
      description:
        'Создать или обновить файл в ветке репозитория с коммитом (используется для фич/фиксов).',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Путь к файлу в репо.',
          },
          content: {
            type: 'string',
            description: 'Содержимое файла в виде текста.',
          },
          message: {
            type: 'string',
            description: 'Текст commit message.',
          },
          branch: {
            type: 'string',
            description: 'Ветка для коммита.',
          },
          repo: {
            type: 'string',
            description:
              'Репозиторий owner/repo, по умолчанию BOTCOW_DEFAULT_REPO.',
          },
        },
        required: ['path', 'content', 'message', 'branch'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_create_pull_request',
      description:
        'Создать Pull Request из ветки head в базовую ветку (обычно main).',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Заголовок PR.',
          },
          head: {
            type: 'string',
            description: 'Исходная ветка (head).',
          },
          base: {
            type: 'string',
            description: 'Целевая ветка (base), по умолчанию main.',
          },
          body: {
            type: 'string',
            description: 'Описание PR.',
          },
          repo: {
            type: 'string',
            description:
              'Репозиторий owner/repo, по умолчанию BOTCOW_DEFAULT_REPO.',
          },
        },
        required: ['title', 'head'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_comment_on_pull_request',
      description: 'Оставить комментарий в Pull Request по номеру.',
      parameters: {
        type: 'object',
        properties: {
          pull_number: {
            type: 'number',
            description: 'Номер PR.',
          },
          body: {
            type: 'string',
            description: 'Текст комментария (markdown).',
          },
          repo: {
            type: 'string',
            description:
              'Репозиторий owner/repo, по умолчанию BOTCOW_DEFAULT_REPO.',
          },
        },
        required: ['pull_number', 'body'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_merge_pull_request',
      description: 'Смерджить Pull Request по номеру.',
      parameters: {
        type: 'object',
        properties: {
          pull_number: {
            type: 'number',
            description: 'Номер PR.',
          },
          repo: {
            type: 'string',
            description:
              'Репозиторий owner/repo, по умолчанию BOTCOW_DEFAULT_REPO.',
          },
        },
        required: ['pull_number'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_run_workflow',
      description:
        'Запустить GitHub Actions workflow (по умолчанию ci.yml на main).',
      parameters: {
        type: 'object',
        properties: {
          workflow_id: {
            type: 'string',
            description: 'Имя или ID workflow, например "ci.yml".',
          },
          ref: {
            type: 'string',
            description: 'Ветка/commit ref, по умолчанию main.',
          },
          repo: {
            type: 'string',
            description:
              'Репозиторий owner/repo, по умолчанию BOTCOW_DEFAULT_REПО.',
          },
          inputs: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Опциональные inputs для workflow.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_get_workflow_status',
      description: 'Получить статус конкретного запуска workflow (run_id).',
      parameters: {
        type: 'object',
        properties: {
          run_id: {
            type: 'number',
            description: 'Идентификатор запуска workflow.',
          },
          repo: {
            type: 'string',
            description:
              'Репозиторий owner/repo, по умолчанию BOTCOW_DEFAULT_REPO.',
          },
        },
        required: ['run_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github_list_workflow_runs',
      description: 'Получить список запусков workflow по workflow_id или по репо.',
      parameters: {
        type: 'object',
        properties: {
          workflow_id: {
            type: 'string',
            description: 'Имя или ID workflow (например "ci.yml"). Если не указан — вернёт запуск по всему репо.',
          },
          branch: {
            type: 'string',
            description: 'Фильтр по ветке (head_branch).',
          },
          event: {
            type: 'string',
            description: 'Фильтр по событию (например "workflow_dispatch").',
          },
          status: {
            type: 'string',
            description: 'Фильтр по статусу (queued, in_progress, completed).',
          },
          per_page: {
            type: 'number',
            description: 'Число возвращаемых записей, по умолчанию 5.',
          },
          repo: {
            type: 'string',
            description: 'Репозиторий owner/repo, по умолчанию BOTCOW_DEFAULT_REPO.',
          },
        },
      },
    },
  },
] as const;

export const githubToolHandlers = {
  async github_get_file(args: { path: string; repo?: string }) {
    const content = await getFile(args.path, args.repo);
    return { path: args.path, repo: args.repo, content };
  },

  async github_create_branch(args: {
    branchName: string;
    baseBranch?: string;
    repo?: string;
  }) {
    return createBranch(args.branchName, args.baseBranch, args.repo);
  },

  async github_commit_file(args: {
    path: string;
    content: string;
    message: string;
    branch: string;
    repo?: string;
  }) {
    const { repo, ...rest } = args;

    if (repo) {
      return commitFile({ ...rest, repo });
    }

    return commitFile(rest);
  },

  async github_create_pull_request(args: {
    title: string;
    head: string;
    base?: string;
    body?: string;
    repo?: string;
  }) {
    return createPullRequest(args);
  },

  async github_comment_on_pull_request(args: {
    pull_number: number;
    body: string;
    repo?: string;
  }) {
    return commentOnPullRequest(args);
  },

  async github_merge_pull_request(args: {
    pull_number: number;
    repo?: string;
  }) {
    return mergePullRequest(args);
  },

  async github_run_workflow(args: {
    workflow_id?: string;
    ref?: string;
    repo?: string;
    inputs?: Record<string, string>;
  }) {
    return runWorkflow(args);
  },

  async github_get_workflow_status(args: { run_id: number; repo?: string }) {
    return getWorkflowStatus(args);
  },

  async github_list_workflow_runs(args: {
    workflow_id?: string;
    branch?: string;
    event?: string;
    status?: string;
    per_page?: number;
    repo?: string;
  }) {
    const runs = await listWorkflowRuns({
      workflow_id: args.workflow_id,
      branch: args.branch,
      event: args.event,
      status: args.status,
      per_page: args.per_page,
      repo: args.repo,
    });

    return { runs };
  },
};
