# BotCow Code Assistant

Продакшн-сервис для автоматизации CI/CD и GitHub-операций через чат-интерфейс.  
Проект развёрнут на Vercel, использует Next.js 16, API-роуты, GitHub API, Vercel Blob и OpenAI.

## Возможности

- Общение с ассистентом (OpenAI)
- Коммиты: создание/обновление файлов в репозитории
- Ветки: создание, удаление
- Pull Request: создание, merge
- Запуск GitHub Actions workflow
- Логирование действий в Vercel Blob
- API для интеграций

## Технологии

- Next.js 16 (App Router)
- Vercel Functions
- Vercel Blob
- GitHub REST API (@octokit/rest)
- OpenAI API
- TypeScript
- PWA (будет добавлено)

## API-роуты

/api/chat
/api/health
/api/logs
/api/github/branch
/api/github/commit
/api/github/delete-branch
/api/github/file
/api/github/merge
/api/github/pr
/api/github/workflow/run
/api/github/workflow/status

## ENV переменные

Все переменные хранятся в Vercel → Production.

OPENAI_API_KEY
BLOB_READ_WRITE_TOKEN
GITHUB_PAT_BOTCOW
BOTCOW_DEFAULT_REPO
VERCEL_TOKEN
VERCEL_PROJECT_ID
VERCEL_TEAM_ID
DATABASE_URL

## Локальный запуск

```bash
npm install
npm run dev

Build

npm run build

Deploy (production)

vercel --prod

Структура проекта
src/
  app/            — UI + API маршруты Next.js
  backend/        — GitHub, Vercel, OpenAI, логика
  server.ts       — Express server (локальные задачи)
docs/             — документация (будет расширена)

Документация дополняется.

