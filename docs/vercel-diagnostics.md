# Vercel diagnostics

This document describes how Botcow diagnoses Vercel deployments.

## Goal

When a Vercel deployment fails or behaves incorrectly at runtime, the bot should be able to inspect real preview runtime signals, not only code, CI, and build status.

The assistant should be able to:

- find the relevant deployment for a given repo / branch / git SHA
- inspect runtime logs for that deployment
- search runtime logs for real failures such as:
  - `400 Unknown parameter: 'reasoning'`
  - route handler errors
  - serverless / function execution errors

## Scope and safety

Runtime log tools are:

- read-only
- limited to preview diagnostics
- not allowed to deploy, redeploy, delete, or mutate Vercel state
- not allowed to access secrets

## Strategy: find deployment

1) **Primary**: match by git SHA

We look at recent deployments for a project and try to match commit metadata to the provided `git_sha`.

2) **Fallback**: match by branch

If SHA matching is not available, we search recent preview deployments by branch.

3) **Optional narrowing**: time window

If several deployments match, the assistant should narrow the result by time range.

## Runtime log tools

### `vercel_list_deployments`

Purpose:
- list recent preview deployments
- filter by repo / branch / git SHA / time range

Parameters:
- `repo` — `owner/name`
- `branch` — git branch filter
- `gitSha` — commit SHA filter
- `since` — ISO timestamp lower bound
- `until` — ISO timestamp upper bound
- `limit` — max number of results

Expected output fields:
- `deploymentId`
- `url`
- `createdAt`
- `state`
- `readyState`
- `branch` if available
- `gitSha` if available

### `vercel_get_runtime_logs`

Purpose:
- fetch runtime logs for a deployment
- support time range and result limits

Parameters:
- `repo` — `owner/name`
- `deploymentId` — Vercel deployment id
- `since` — ISO timestamp lower bound
- `until` — ISO timestamp upper bound
- `limit` — max number of log records
- pagination fields if supported by backend adapter

Expected output fields per record:
- `timestamp`
- `level`
- `message`
- `route`
- `functionName`
- `deploymentId`
- `branch` if available
- `gitSha` if available

### `vercel_search_runtime_logs`

Purpose:
- search runtime logs by text and filters

Parameters:
- `repo` — `owner/name`
- `deploymentId` — Vercel deployment id
- `query` — text or pattern to search
- `level` — `info | warn | error`
- `route` — route filter
- `functionName` — function filter
- `since` — ISO timestamp lower bound
- `until` — ISO timestamp upper bound
- `limit` — max number of matching records

Expected output:
- filtered log records with the same schema as `vercel_get_runtime_logs`
- summary fields such as match count when available

## How the assistant should use this

Recommended runtime diagnostics flow:

1. resolve the target deployment with `vercel_list_deployments`
2. fetch recent runtime logs with `vercel_get_runtime_logs`
3. if needed, search errors with `vercel_search_runtime_logs`
4. confirm the real failing runtime path before claiming a fix

This allows the assistant to validate:
- real request failures
- actual failing route or function
- model / reasoning payload problems
- payload keys and SDK-related runtime mismatches

## Notes

- Runtime log availability and field shape depend on Vercel API/account capabilities.
- If Vercel returns a different event schema, the backend adapter should normalize it into the fields documented above.
- The assistant must report honestly when logs are unavailable or partially available.
