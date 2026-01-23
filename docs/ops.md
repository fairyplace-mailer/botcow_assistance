# Ops

## Preview deploys

- Preview deploys are created by Vercel.
- To retrieve the **actual preview URL**, use Vercel API via tools (never guess URLs).

## GitHub code search

`github_search_in_repo` uses **GitHub REST Search API** (`/search/code`).
GitHub GraphQL `SearchType` currently does **not** include `CODE`, so GraphQL cannot be used for code search.

## Preview smoke checks (recommended)

This project includes tools to:
- resolve the latest Vercel preview URL
- run safe HTTP requests to that URL (SSRF-protected)
- run a small smoke-check suite against the preview

### `preview_get_url`
Returns the preview deployment URL.

Example `/tools/call`:

```bash
curl -sS "$BASE_URL/tools/call" \
  -H "Authorization: Bearer $BOTCOW_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"preview_get_url","arguments":{"repo":"fairyplace-mailer/botcow_assistance","branch":"provecta"}}'
```

### `preview_http_request`
Safe HTTP client restricted to `https://*.vercel.app`.

### `preview_smoke_check`
Runs these checks:
- `GET /`
- `GET /tools`
- `POST /tools/call`:
  - `github_get_repo_structure`
  - `github_get_file`
  - `github_self_check_search_schema`
  - `github_search_in_repo` (narrow query)

## Cron (Vercel Hobby)

Vercel Hobby has strict limits on cron frequency.
For this project:
- `devwix-ingest` runs **daily 04:00 UTC**: `0 4 * * *`
