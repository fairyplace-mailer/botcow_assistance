# GitHub Actions checklist (manual UI)

This checklist is used when CI does not run, runs but fails with permissions, or the bot cannot fetch logs.

## 1) Confirm Actions is enabled for the repository
**GitHub UI:** Repository → **Settings** → **Actions** → **General**

- **Actions permissions**
  - Usually: **Allow all actions and reusable workflows**
  - If you use restrictions: ensure the used actions are allowed.

## 2) Confirm workflow permissions (GITHUB_TOKEN)
**GitHub UI:** Repository → **Settings** → **Actions** → **General** → **Workflow permissions**

Recommended default for this project:
- **Read and write permissions**
- Enable: **Allow GitHub Actions to create and approve pull requests** (only if the bot must create/modify PRs)

Typical symptom if too strict:
- `Resource not accessible by integration`
- `403: Forbidden`

## 3) Confirm the workflow is actually triggered
Common causes:
- The workflow `on:` does not include your branch.
- The workflow is limited to `workflow_dispatch` only.
- The workflow file is not on the branch you pushed.

**Check:** Actions tab → select workflow → see if a run appears for your commit.

## 4) Confirm required secrets exist
**GitHub UI:** Repository → **Settings** → **Secrets and variables** → **Actions**

This repo typically expects (names may differ):
- `BOTCOW_GITHUB_PAT`
- `OPENAI_API_KEY`
- `BLOB_READ_WRITE_TOKEN`

If a secret is missing, the workflow may fail at runtime.

## 5) Branch protection / required checks
If merges are blocked or checks never complete:
**GitHub UI:** Repository → **Settings** → **Branches**

- Ensure required status checks match real workflow names.
- If you renamed workflows, update required checks.

## 6) Fork / PR limitations (if applicable)
If runs are from forks, secrets are not exposed by default.

**Symptom:** workflows run but cannot deploy / cannot access private resources.

## 7) If the bot still cannot fetch logs
Possible reasons:
- token scopes are insufficient
- logs are expired
- the run is from a different repo / wrong repo context

In that case, use the bot command:
- “Diagnose latest CI” (bot pulls jobs + logs) and it will output the next actions.
