# Environment

## Required

- `BOTCOW_ADMIN_TOKEN`

## Optional

### `BOTCOW_CODEX_CHAT_COMPAT`

Controls whether the router is allowed to select the `gpt-5.1-codex-max` model.

Why: some providers / gateways expose `gpt-5.1-codex-max` as a **non-chat** model.
If selected, calls to `v1/chat/completions` may fail with an error like:
`This is not a chat model and thus not supported in the v1/chat/completions endpoint.`

- Default: disabled (treat as `false`).
- Enable: set `BOTCOW_CODEX_CHAT_COMPAT=1`.

When disabled, code-generation / small refactor requests will fall back to:
- `gpt-5.2` with `reasoning.effort=high`.
