# Botcow Assistance 

## Purpose

A small web app that runs a chat assistant and includes a set of admin-only tools (GitHub, Vercel, etc.).

## Tooling notes

- `github_search_in_repo` uses **REST** code search (`octokit.search.code` / `GET /search/code`).
  - Rationale: GitHub GraphQL schema does not currently include `SearchType = CODE`, so GraphQL cannot be used for code search.
- `github_self_check_search_schema` introspects GitHub GraphQL `SearchType` to list enum values (admin-only tool).
