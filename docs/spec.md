# Spec

## Constraints

- Work only in the specified repository and branch.
- Preview deployments only (no production deploy).

## GitHub code search

- `github_search_in_repo` MUST use GitHub REST `GET /search/code`.
- GitHub GraphQL `SearchType` currently has no `CODE` value.

## Preview verification tools

The project provides preview verification tools:
- `preview_get_url`: resolves latest Vercel preview URL via Vercel API.
- `preview_http_request`: SSRF-protected HTTP client restricted to `https://*.vercel.app`.
- `preview_smoke_check`: runs HTTP + tools smoke checks against the preview.

## Cron schedule (Vercel Hobby)

- `devwix-ingest` runs daily 04:00 UTC (`0 4 * * *`).
