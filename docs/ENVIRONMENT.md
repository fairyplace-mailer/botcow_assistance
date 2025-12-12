# Environment variables

Below is a list of environment variables used by the project.

## Required

- `OPENAI_API_KEY` — OpenAI API key.
- `GITHUB_PAT_BOTCOW` — GitHub Personal Access Token used by the bot.
- `BOTCOW_DEFAULT_REPO` — default repo in `owner/name` format.

## Optional

- `BLOB_READ_WRITE_TOKEN` — Vercel Blob token (required if you use Blob-backed stores).

## CI / GitHub Actions

- `GITHUB_WEBHOOK_SECRET` — secret for validating GitHub webhooks.

## Vercel

### Webhooks

- `VERCEL_WEBHOOK_SECRET` — secret used to validate incoming Vercel webhooks on:
  - `POST /api/vercel/webhook`

Without this variable the endpoint returns `500` and does not accept webhooks.

### API (optional)

- `VERCEL_TOKEN` — Vercel API token (used for polling helpers like `getLatestDeployments()` and `getDeploymentStatus()`).
- `VERCEL_TEAM_ID` — Vercel team id.
- `VERCEL_PROJECT_ID` — Vercel project id.
