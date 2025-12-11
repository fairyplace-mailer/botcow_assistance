CI run tracking — endpoints and usage

Overview

This project includes lightweight server endpoints to trigger GitHub Actions workflows and to query their status. Because GitHub's createWorkflowDispatch API does not return a run_id synchronously, the implementation stores a small placeholder record and attempts to resolve the actual run_id later.

Files and endpoints

1) POST /api/github/workflow/run
- Payload (JSON): { workflow_id?: string, ref?: string, repo?: string, inputs?: Record<string,string> }
- Behavior:
  - Triggers GitHub Actions workflow_dispatch for the specified workflow_id (default: "ci.yml") on the specified ref (branch, default: "main").
  - Stores a placeholder record in .botcow/ci-runs.json with run_id: -1, workflow_id and ref, and startedAt timestamp.
  - Returns { result, note: 'dispatched' } on success.
- Notes: GitHub's API does not return run_id on dispatch. The endpoint saves a placeholder and the status endpoint tries to resolve the real run_id.

2) POST /api/github/workflow/status
- Payload (JSON): { run_id?: number, repo?: string }
- Behavior:
  - If run_id provided — returns workflow run detail using GitHub API (getWorkflowRun).
  - If run_id omitted — reads last tracked run from .botcow/ci-runs.json for the given repo (or BOTCOW_DEFAULT_REPO if omitted).
    - If stored run has run_id === -1, the endpoint lists recent workflow runs for the repo and tries to match by head_branch or head_sha to resolve actual run_id, updates the store and then returns the run detail.
- Returns full workflow run object on success, or an error message indicating cause.

Persistent store

- Location: .botcow/ci-runs.json (created automatically by the backend when needed)
- Format (per-repo):
  {
    "owner/repo": {
      "run_id": number,
      "workflow_id": string,
      "ref": string,
      "startedAt": "ISO timestamp"
    }
  }

Permissions required

- GITHUB PAT used by the backend must have at least: repo and workflow scopes (to dispatch workflows and read workflow runs).

How to test locally

1) Trigger dispatch:
   curl -X POST -H "Content-Type: application/json" -d '{"workflow_id":"ci.yml","ref":"botcow-prevectus"}' https://<your-deploy>/api/github/workflow/run

2) After a few seconds, query status:
   curl -X POST -H "Content-Type: application/json" -d '{}' https://<your-deploy>/api/github/workflow/status

Or provide run_id to the status endpoint if you have it.

Notes and troubleshooting

- If status endpoint returns 404: no run tracked for repo.
- If status endpoint returns 500 with GitHub API errors (404/403): check token permissions (workflow scope) and repository name.
- Because of timing, resolution of run_id can take a few seconds; if not found immediately, retry the status endpoint after a short delay.
