# BotCow Core v1 — Ready-to-Drop Package

Canonical replacement package for the BotCow golden core.

## Replace / add in this order

1. `strong_spec.md`
2. `src/backend/contracts/chat.ts`
3. `src/backend/prompt/buildCoreInstructions.ts`
4. `src/backend/openaiRuntime.ts`
5. `src/backend/openai.ts`
6. `src/backend/modelRouter.ts`
7. `src/backend/responses.ts`
8. `src/backend/assistant.ts`
9. `src/app/api/chat/route.ts`
10. `tests/contracts/*`

## Rule

These files are the golden core.
They must be integrated without local rewrites.
Surrounding code must be adapted to them.
