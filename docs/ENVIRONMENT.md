# Переменные окружения BotCow Code Assistant

Все переменные задаются в Vercel → Production.

## Переменные

### OpenAI
- `OPENAI_API_KEY`

### Vercel Blob
- `BLOB_READ_WRITE_TOKEN`

### GitHub
- `GITHUB_PAT_BOTCOW`
- `BOTCOW_DEFAULT_REPO`

### Vercel API
- `VERCEL_TOKEN`
- `VERCEL_PROJECT_ID`
- `VERCEL_TEAM_ID`

### База данных (будущее)
- `DATABASE_URL`

## Локальное использование
Создать файл `.env.local`:

OPENAI_API_KEY=...
BLOB_READ_WRITE_TOKEN=...
GITHUB_PAT_BOTCOW=...
BOTCOW_DEFAULT_REPO=fairyplace-mailer/botcow_assistance
VERCEL_TOKEN=...
VERCEL_PROJECT_ID=...
VERCEL_TEAM_ID=...
DATABASE_URL=…

