# Ops

## Environment variables

See `docs/ENVIRONMENT.md`.

## Cron

### Vercel cron jobs

- `devwix-ingest`: runs **daily at 04:00 UTC** (`0 4 * * *`).
  - Reason: Vercel Hobby plan allows only daily cron jobs (no more frequent schedules).
  - If you upgrade to Pro, you can increase frequency if needed.

## GitHub tools

### github_search_in_repo

`github_search_in_repo` uses **GitHub REST Search API** (`GET /search/code` via Octokit `octokit.search.code`).

Reason: GitHub GraphQL schema currently does not expose `SearchType = CODE` for code search, so GraphQL cannot be used as a compatible implementation.

### github_self_check_search_schema

Self-check tool that introspects GitHub GraphQL schema to list enum values of `SearchType`.

Call it via `/tools/call`:

```bash
curl -sS \
  -H "Authorization: Bearer $BOTCOW_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"github_self_check_search_schema","arguments":{}}' \
  https://YOUR_DOMAIN/tools/call
```

It returns:

```json
{ "ok": true, "result": { "ok": true, "searchTypeEnumValues": ["..."] } }
```
