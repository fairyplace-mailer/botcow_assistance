# Multi-repo configuration (BotCow)

BotCow can work with multiple repositories that belong to the owner.

This is configured in **`config/repos.yml`**.

## Why this exists

- Safety: BotCow will only operate on repositories that are explicitly listed.
- Convenience: default repo and per-repo defaults (like default branch) are stored in git.

## File format

Top-level keys:

- `version`: config version (currently `1`).
- `defaultRepo`: repo used when user doesn't specify one.
- `repos`: allowlist.

Each item in `repos`:

- `repo`: `owner/name`.
- `defaultBranch`: optional.
- `vercel.projectIdEnv`: name of env var where Vercel Project ID is stored.
- `vercel.teamIdEnv`: name of env var where Vercel Team ID is stored.

Example:

```yml
version: 1

defaultRepo: fairyplace-mailer/botcow_assistance

repos:
  - repo: fairyplace-mailer/botcow_assistance
    defaultBranch: botcow-prevectus
    vercel:
      projectIdEnv: VERCEL_PROJECT_ID
      teamIdEnv: VERCEL_TEAM_ID

  - repo: fairyplace-mailer/botcat_chat
    defaultBranch: main
    vercel:
      projectIdEnv: VERCEL_PROJECT_ID_BOTCAT_CHAT
      teamIdEnv: VERCEL_TEAM_ID
```

## Notes

- `config/repos.yml` is the **single source of truth**.
- If a repo is not listed in `repos`, BotCow will refuse to operate on it.
- `BOTCOW_DEFAULT_REPO` is **not supported** (by design). If you need to change
  the default repo, edit `config/repos.yml`.
