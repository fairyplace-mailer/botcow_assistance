#   (BotCow)

> :        .     .

---

##    

### BOTCOW_ADMIN_TOKEN

Tools endpoints are **owner-only** and require Bearer auth.

- Env: `BOTCOW_ADMIN_TOKEN`
- Header: `Authorization: Bearer <BOTCOW_ADMIN_TOKEN>`

Endpoints:
- `GET /tools`
- `POST /tools/call`

If `BOTCOW_ADMIN_TOKEN` is not configured  endpoints **fail closed** (return 500).

---

## Vercel tools policy (preview only)

All Vercel tools must operate in **preview** target only.

- Any attempt to use `target=production` must fail.
- If `target` is omitted it defaults to `preview`.

Applies to:
- `vercel_get_latest_deployments`
- `vercel_trigger_deploy`
- `vercel_redeploy`
- `vercel_diagnose_deployment`

---

## Repo allowlist and registration

The bot operates only on repositories explicitly listed in `config/repos.yml`.
New repositories can be added via the owner-only `repo_register` tool (see section 7.3.5).
