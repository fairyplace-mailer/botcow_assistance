# Vercel Preview links in Pull Requests

[1mGoal[0m: for every PR, show whether Vercel deployed, the preview URL, and the current deployment status.

This repository uses a GitHub Actions workflow (`.github/workflows/vercel-preview.yml`) that:

1. Runs on PR events: `opened`, `synchronize`, `reopened`.
2. Waits a little for Vercel to start its Git Integration deployment.
3. Queries the Vercel API for recent deployments of the configured Vercel project.
4. Finds the latest deployment that matches the PR commit SHA.
5. Upserts (updates/creates) a single PR comment with:
   - status (`readyState`)
   - preview URL
   - logs/details link

## Required GitHub Secrets

Configure these in: **GitHub repo  Settings  Secrets and variables  Actions**

- `VERCEL_TOKEN` [3m(required)[0m
- `VERCEL_PROJECT_ID` [3m(required)[0m
- `VERCEL_TEAM_ID` [3m(optional)[0m (only if the project is under a Vercel Team)

The workflow uses the built-in `GITHUB_TOKEN` to post comments in PRs.

## Notes / troubleshooting

- If the workflow comment says it can't find a deployment yet, it usually means Vercel hasn't created the deployment at the moment the workflow ran. Re-run the workflow or push a new commit.
- On the Vercel Hobby plan, Vercel Webhooks are not available; polling via the Vercel API is used.
- To avoid double deployments, the workflow does [1mnot[0m create a new Vercel deployment. Vercel Git Integration remains the single source of deployments.
