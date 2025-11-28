# Архитектура BotCow Code Assistant

Проект — серверное приложение на Next.js 16 с API-маршрутами, GitHub-интеграцией и логированием в Vercel Blob. UI — чат-интерфейс (позже расширенный).

## Компоненты

### 1. Frontend (Next.js App Router)
- `/app/page.tsx` — UI чата.
- Клиентские компоненты: ввод, вывод, загрузка файлов (будет добавлено).
- PWA-манифест + сервис-воркер (будет добавлено).

### 2. Backend (API Routes)
Каждый маршрут — отдельная серверная функция:

- `/api/chat` — прокси к OpenAI.
- `/api/logs` — запись логов в Blob.
- `/api/github/*` — операции с GitHub:
  - branch create/delete
  - commit file
  - get file
  - create PR
  - merge PR
  - run workflow
  - get workflow status

### 3. GitHub backend (src/backend/github.ts)
Реализует:
- получение/обновление файлов
- создание веток
- коммиты
- PR
- workflow

Работает через `@octokit/rest`.

### 4. OpenAI backend
`src/backend/openai.ts` — инициализация OpenAI API.

### 5. Vercel Blob
`src/backend/blob.ts` — добавление логов и файлов.

### 6. Express server (локально)
`src/server.ts` — минимальный Express-сервер (тест/локальные инструменты).

### 7. Vercel Deploy
- Автоматические билды из GitHub.
- ENV хранятся в Production:

OPENAI_API_KEY
BLOB_READ_WRITE_TOKEN
GITHUB_PAT_BOTCOW
BOTCOW_DEFAULT_REPO
VERCEL_TOKEN
VERCEL_PROJECT_ID
VERCEL_TEAM_ID
DATABASE_URL

