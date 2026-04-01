# Model routing (GPT-5.4 family)

This project routes chat requests to one of:

- `gpt-5.4`
- `gpt-5.4-mini`
- `gpt-5.4-nano`

The router lives in `src/backend/modelRouter.ts` and exports:

- `OPENAI_EMBEDDING_MODEL` (unchanged)
- `chooseModel(messages)` → `{ model, reasoning?: { effort }, reason, debug? }`

## Debug mode

`debug` is returned **only** when:

```ts
const isDebugMode = process.env.NODE_ENV !== 'production';
```

In production, `debug` is omitted.

## Reasoning effort scale

- `none`: trivial / fast-path / simple classification
- `low`: small codegen / short explanation
- `medium`: standard engineering tasks
- `high`: complex debug / review / architecture
- `xhigh`: severe debug / very large diff / long risky context (forces `gpt-5.4`)

## Rule order (hard rules)

The router applies the following rules in order (higher wins):

| Rule | When | Model | Effort | reason |
|---|---|---|---|---|
| 1 | No user text | `gpt-5.4-mini` | `none` | `no-user-text` |
| 2 | Classification / extraction / ranking / JSON-only | `gpt-5.4-nano` | `none` / `low` | `classification-or-extraction-or-ranking` |
| 3 | Stack trace / bug / review / big diff / heavy error payload | `gpt-5.4` | `high` / `xhigh` | `deep-code-debug-review` |
| 4 | Architecture / design / system decisions | `gpt-5.4` | `high` | `architecture-or-design` |
| 5 | Codegen / refactor / file edits | `gpt-5.4-mini` or `gpt-5.4` | `low`/`medium` or `high` | `codegen-or-refactor*` |
| 6 | PM/status/deploy/CI/Vercel (without deep errors) | `gpt-5.4-mini` | `low` / `medium` | `pm-or-status-or-ci-cd-or-deploy` |
| 7 | Short general request | `gpt-5.4-mini` | `low` | `short-general-request` |
| 8 | Long context (many messages / long total text) | `gpt-5.4` | `medium` / `high` | `long-context-general` |
| 9 | Fallback | prefer `mini` unless risky | varies | varies | `fallback-*` |

## Score-based routing

Before hard rules, the router computes:

- `nanoScore`, `miniScore`, `fullScore`
- `noneScore`, `lowScore`, `mediumScore`, `highScore`, `xhighScore`

based on:

- message count
- last user message length
- estimated total text length
- code/diff/error marker counts
- keyword flags (code, diff, error, PM, CI, security, multi-file intent, etc.)

Then it:

1) picks a model family by score
2) picks an effort by score
3) applies hard overrides (rules above)
4) clamps effort to model limits:

- `gpt-5.4-nano`: `none|low`
- `gpt-5.4-mini`: `none|low|medium|high`
- `gpt-5.4`: `none|low|medium|high|xhigh`
