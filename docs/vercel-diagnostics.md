# Vercel diagnostics

This document describes how Botcow diagnoses Vercel deployments.

## Goal

When a Vercel deployment fails, the bot should:

- find the relevant deployment for a given git commit SHA
- return a clickable URL to inspect logs (inspector URL when available)
- provide a short summary

## Strategy: find deployment

1) **Primary**: match by git SHA

We look at recent deployments for a project and try to match `meta.githubCommitSha` (or similar metadata) to the provided `git_sha`.

2) **Fallback (documented)**: match by **branch + time window**

If SHA matching is not available, we look for a deployment where:

- deployment meta contains the requested branch name
- deployment `createdAt` is within a time window (default **180 minutes**)

This is an explicit strategy and is considered acceptable for Hobby constraints.

3) **Last resort**: latest deployment

If neither SHA nor fallback can match, the bot can return the latest deployment and label it as `matchedBy: latest`.

## Tool: `vercel_diagnose_deployment`

Parameters:

- `repo` (optional): `owner/name` - used to resolve Vercel `projectId/teamId` via `config/repos.yml`
- `git_sha` (recommended): git commit SHA
- `branch` (optional): branch name for fallback
- `target` (optional): `preview` or `production` (default: `preview`)
- `timeWindowMinutes` (optional): fallback time window (default: 180)

Output:

- `summary`: short status summary
- `matchedBy`: `sha | branch_time_window | latest | none`
- `inspectorUrl/logsUrl`: clickable URL when available
- `deploymentId`, `readyState`, `state`, `url`

## Notes

- Vercel API does not always provide a dedicated `logsUrl`. We treat `inspectorUrl` as the primary link.
- Project/team are resolved from `config/repos.yml` using env keys (`projectIdEnv/teamIdEnv`).
