# STRONG_SPEC — BotCow Core Runtime and Self-Rewrite Policy

Version: 1.0  
Date: 2026-04-04  
Status: Canonical implementation spec for core runtime replacement

## 0. Document Status

This file is the canonical hard specification for the BotCow core runtime.
It is based on the current BotCow code/spec state and on selected operational rules borrowed from the BotCat SSoT, but adapted for a **single-owner coding assistant**.

Anything not explicitly allowed here SHALL NOT be invented in code.
Temporary shortcuts in core runtime are forbidden.

## 1. Purpose

The purpose of this file is to define a stable core for BotCow so that the bot can:
- work reliably with OpenAI Responses API;
- rewrite and improve the surrounding project **without weakening or mutating its own core rules**;
- stay cost-aware for free-tier or low-budget infrastructure;
- keep GitHub / Vercel / DB / storage / embeddings usage under control;
- avoid self-serving simplifications, compatibility hacks, and silent regressions.

## 2. Product Definition

BotCow is a coding assistant for one owner only.
It is not a public SaaS chatbot.
It is not a multi-user product.
It is not a general end-user chat product.

Primary purpose:
- inspect private repos via tools;
- propose and implement changes in code;
- run CI / preview / repo operations through tools;
- explain status and errors briefly and honestly;
- gradually improve its own codebase under strict rules.

## 3. Ownership and Access Model

### 3.1 Single-owner mode

BotCow SHALL operate in `single_owner_no_auth` mode.
There is exactly one human owner/operator.
No end-user auth model is required.
No allowlist is required.
No user profile model is required for chat access.

### 3.2 Allowed server-side secrets and protected routes

The following MAY still remain protected server-side:
- admin/service routes;
- cron routes;
- webhook routes;
- repo mutation / deployment operations when already protected by server-side secrets.

### 3.3 Forbidden auth complexity

The following are forbidden in BotCow core v1 unless explicitly requested later:
- multi-user auth;
- session-to-user promotion flows;
- allowlist logic for chat access;
- owner history separation by multiple users;
- any `/pro`-style protected product mode.

## 4. Core Principles

1. Backend SHALL be the only source of truth.
2. Frontend SHALL be dumb UI only.
3. Core runtime SHALL be deterministic and policy-driven.
4. Model choice SHALL be owned by backend, not by prompt text and not by the model itself.
5. Self-rewrite safeguards SHALL be stronger than ordinary coding-task safeguards.
6. Core files SHALL be immutable unless the owner explicitly orders their replacement.
7. The system SHALL prefer correctness and traceability over convenience.
8. The system SHALL degrade optional cost-heavy features before degrading core coding functionality.

## 5. Golden Core Policy

### 5.1 Golden core files

The following files form the BotCow golden core runtime:

- `src/app/api/chat/route.ts`
- `src/backend/assistant.ts`
- `src/backend/modelRouter.ts`
- `src/backend/openai.ts`
- `src/backend/openaiRuntime.ts`
- `src/backend/responses.ts`

The following directories are also core when introduced by the replacement runtime:

- `src/backend/prompt/*`
- `src/backend/contracts/*`
- `src/backend/guards/*`
- `tests/contracts/*`

### 5.2 Immutability rule

If the owner provides golden core files, BotCow SHALL:
- integrate them **without modifying them**;
- adapt surrounding code to them;
- not rewrite, reformat, simplify, merge, split, or “improve” them unless the owner explicitly orders that exact change.

### 5.3 Conflict rule

If old project code conflicts with golden core, the surrounding code SHALL be adapted to golden core.
Golden core SHALL win.

### 5.4 Anti-bypass rule

BotCow SHALL NOT bypass golden core by:
- creating shadow contracts elsewhere;
- reintroducing old logic through adapters;
- restoring old behavior “for compatibility” without explicit permission;
- patching around core decisions in prompt text.

## 6. Canonical Core Architecture

### 6.1 Route layer

`src/app/api/chat/route.ts` SHALL be a thin transport/controller layer.
It SHALL NOT contain:
- giant system prompt text;
- business routing heuristics;
- inline RAG assembly policy;
- response normalization policy;
- compatibility hacks for obsolete completion formats.

### 6.2 Required runtime split

Core runtime SHALL be split into dedicated modules.
Minimum required separation:
- transport/controller;
- prompt/policy assembly;
- model routing;
- assistant orchestration;
- Responses API helpers;
- runtime capability checks;
- response normalization;
- contracts/types;
- guards.

### 6.3 Forbidden monolith rule

A single giant `route.ts` containing transport + prompt + routing + RAG + compatibility handling is forbidden.

## 7. Chat API Contract

### 7.1 Canonical endpoint

Primary endpoint: `POST /api/chat`

### 7.2 Minimum request contract

The request SHALL accept a JSON payload with at least:
- `messages`

The request MAY also carry backend-safe hints later, but the canonical v1 contract SHALL remain simple.

### 7.3 Minimum response contract

The chat route SHALL return normalized JSON.
It SHALL NOT return raw legacy completion payloads as the public contract.

Minimum normalized shape:
- `ok`
- `sessionId` or equivalent request/session correlation id if used
- `response` object on success
- `error` object on failure

### 7.4 Public error discipline

User-facing errors SHALL be short, deterministic, and non-technical.
Raw provider payloads, stack traces, and secret-bearing details are forbidden in user-visible responses.

## 8. Responses API Runtime Policy

### 8.1 Canonical API

BotCow core SHALL use OpenAI Responses API as the canonical model execution path.

### 8.2 Canonical state handling

Cross-turn state SHALL use Responses API state primitives only:
- `conversation`
- or `previous_response_id`
- or stateless mode

State mode selection SHALL be deterministic.
Conversation state and previous-response state SHALL never be mixed incorrectly in one request.

### 8.3 Tool calling

Custom function tools are allowed.
Tool calls SHALL be validated server-side.
Function-call output SHALL be returned using canonical `function_call_output` items.

### 8.4 Forbidden legacy behavior

The core SHALL NOT pretend to be a legacy Chat Completions runtime.
Compatibility shims that distort the Responses API contract are forbidden in core.

## 9. Model Routing and Reasoning Policy

### 9.1 Allowed chat models

Allowed core chat models:
- `gpt-5.4`
- `gpt-5.4-mini`
- `gpt-5.4-nano`

### 9.2 Allowed reasoning effort values used by BotCow core

BotCow core SHALL use these reasoning levels:
- `none`
- `low`
- `medium`
- `high`
- `xhigh`

### 9.3 Default routing intent

Default routing SHALL prefer the cheaper adequate model.
BotCow SHALL NOT default to full model or high reasoning without cause.

### 9.4 Canonical routing intent by task class

Default expectations:
- classification / extraction / ranking -> `gpt-5.4-nano`
- ordinary short/medium coding help -> `gpt-5.4-mini`
- CI/CD / deploy / PM / repo-status -> `gpt-5.4-mini`
- complex debug / review / architecture / long context -> `gpt-5.4`

Default expectations for reasoning:
- very light task -> `none`
- ordinary coding task -> `low`
- medium complexity / synthesis -> `medium`
- deep debug / architecture / self-rewrite core -> `high`
- only rare hardest cases -> `xhigh`

### 9.5 Self-rewrite override

If the task touches any golden core file, routing SHALL be forcibly escalated.

Minimum rule:
- any golden-core rewrite task -> `gpt-5.4`
- minimum reasoning -> `high`
- retry after failed attempt -> MAY escalate to `xhigh`

### 9.6 Router inputs

Model routing SHALL NOT depend only on the raw user text.
The router SHALL support explicit backend signals, including at minimum when available:
- task touches golden core files;
- previous attempt failed;
- task is tool-heavy;
- RAG source count;
- source conflict;
- long context size;
- multi-file intent.

### 9.7 Hard safety override

`gpt-5.4-nano` SHALL NOT be allowed for:
- stack traces;
- bug/debug tasks;
- diff review;
- architecture questions;
- self-rewrite;
- multi-file risky changes.

## 10. Prompt and Policy Layer

### 10.1 Separate prompt layer required

Prompt/policy assembly SHALL live outside `route.ts`.
A dedicated prompt layer is mandatory.

### 10.2 Priority of truth

For runtime behavior, priority SHALL be:
1. supported OpenAI Responses API strong-mode/runtime rules and contract;
2. this strong spec;
3. golden core code;
4. explicit owner instructions in the current task;
5. repository docs such as `docs/spec.md`;
6. tool-observed facts.

The model SHALL NOT invent missing rules.

### 10.3 Forbidden prompt inflation

Huge inline monolithic prompt strings inside route handlers are forbidden in the canonical replacement core.

## 11. Self-Rewrite Rules

### 11.1 General rule

BotCow MAY rewrite non-core parts of the project.
BotCow SHALL treat self-rewrite as a high-risk task.

### 11.2 Golden core restriction

Without explicit owner instruction, BotCow SHALL NOT:
- mutate golden core;
- soften guardrails;
- reduce validation;
- downgrade routing rules;
- restore raw completion compatibility;
- collapse separated layers back into one file;
- add temporary hacks into core to “make the rest compile”.

### 11.3 When owner provides replacement core

If the owner supplies full replacement core files, BotCow SHALL:
- install them exactly;
- adapt imports, tests, neighboring modules, types, and callers around them;
- report any incompatibilities honestly;
- not negotiate the core downward.

### 11.4 Forbidden self-serving behavior

The bot SHALL NOT choose a weaker model, lower reasoning, smaller scope, or weaker contract merely because that makes the rewrite easier.

## 12. Tool Execution Policy

### 12.1 Existing guardrails retained

The following current protection concepts SHALL remain in core:
- tool timeout;
- tool loop limit;
- total tool call budget;
- repeated-tool-call detection;
- no-progress abort;
- strict function tool schema building;
- server-side tool arg parsing and validation;
- structured logging.

### 12.2 Required improvements

The core SHALL add or preserve:
- deterministic normalization of tool errors;
- runtime-safe reasoning suppression logging;
- bounded retry only where clearly safe;
- idempotent behavior where a repeated call can happen.

### 12.3 Forbidden behavior

The model SHALL NOT assume tool success without tool evidence.
The runtime SHALL NOT silently swallow tool failures and continue pretending success.

## 13. RAG / Ingest / Embeddings / Cleanup Policy

### 13.1 Scope

RAG is allowed for coding/reference help.
Current known source in existing BotCow is `dev.wix.com` docs.
Later sources MAY be added explicitly.

### 13.2 Official knowledge source registry

Official knowledge sources SHALL be declared explicitly in backend configuration and repository-controlled manifests.

Minimum required fields for an official knowledge source:
- `sourceKey`
- `sourceKind`
- `seedManifestPath`
- `scopeAllowlist`
- `status`

For BotCow core v1, the canonical official public-doc source is:

- `sourceKey = wix_docs_public`
- `sourceKind = public_http_docs`
- `seedManifestPath = docs/rag/dev_wix.seed.txt`
- `scopeAllowlist = https://dev.wix.com/docs/*`

Only URLs matching the declared scope allowlist MAY be ingested into that source.

### 13.3 No UI upload rule

Frontend file upload is out of scope for BotCow core v1.
If the owner wants to supply knowledge files, the expected path is repository-based documents, such as `.md` files under `docs/` or another canonical repo folder.

### 13.4 Seed manifest rule

Official public-doc ingest SHALL begin from an owner-controlled seed manifest stored in the repository.

Minimum rules:
- the seed manifest SHALL be plain text;
- it SHALL contain one canonical URL per line;
- duplicate URLs SHALL be removed before queueing;
- out-of-scope URLs SHALL be rejected;
- external URLs outside the declared source scope SHALL NOT be queued;
- the runtime SHALL canonicalize URLs before persistence.

Blind discovery outside the seed manifest is forbidden unless the owner explicitly adds a separate approved discovery mechanism.

### 13.5 Event-driven ingest only

Ingest SHALL be event-driven only.
Blind cron ingest is forbidden.
Cron is allowed for cleanup and maintenance, not as the primary ingest trigger.

### 13.6 Bootstrap mode for empty knowledge base

The core SHALL support owner-triggered bootstrap for an empty or incomplete knowledge base.

Bootstrap mode minimum rules:
- bootstrap SHALL start only by explicit owner action or protected server-side route;
- bootstrap SHALL read the repository seed manifest;
- bootstrap SHALL create or reuse the declared official knowledge source;
- bootstrap SHALL enqueue documents deterministically;
- bootstrap SHALL run in bounded batches;
- bootstrap SHALL be resumable after interruption;
- bootstrap SHALL be idempotent when re-run;
- bootstrap SHALL NOT require cron as its primary driver.

Owner-triggered bootstrap is allowed under the event-driven ingest rule and SHALL NOT be treated as blind cron ingest.

### 13.7 Knowledge persistence contract

The replacement core SHALL persist official knowledge in structured storage.

Minimum required entities:
- `knowledge_sources`
- `knowledge_jobs`
- `knowledge_documents`
- `knowledge_chunks`

Minimum requirements for `knowledge_sources`:
- unique source key;
- source kind;
- seed manifest path;
- declared status.

Minimum requirements for `knowledge_jobs`:
- source id;
- job kind;
- job status;
- deterministic counters;
- resumable cursor or equivalent continuation state;
- start/finish timestamps.

Minimum requirements for `knowledge_documents`:
- source id;
- original URL;
- canonical URL;
- section or equivalent source partition;
- title when available;
- normalized markdown content;
- content hash;
- last HTTP status;
- document status;
- fetch and embed timestamps;
- last error when failed.

Minimum requirements for `knowledge_chunks`:
- document id;
- chunk index;
- chunk text;
- token count or equivalent size metric;
- embedding vector;
- text hash.

The runtime SHALL enforce uniqueness at least for:
- `(source_id, canonical_url)`
- `(document_id, chunk_index)`

### 13.8 Document lifecycle and statuses

The document lifecycle SHALL be explicit and deterministic.

Minimum document statuses:
- `pending`
- `fetched`
- `extracted`
- `embedded`
- `ready`
- `failed`
- `deleted`

Minimum job statuses:
- `queued`
- `running`
- `paused`
- `done`
- `failed`

The runtime SHALL NOT silently skip a failed document without recording status and error class.

### 13.9 Fetch / extract / normalize contract

For approved public-doc sources, the pipeline SHALL operate in this order:

1. read URL from seed manifest or queued document record;
2. canonicalize the URL;
3. fetch the document;
4. verify acceptable response class and content type;
5. extract the main article content;
6. extract title, headings, and code blocks when present;
7. normalize extracted content into stable markdown;
8. compute content hash from normalized markdown;
9. compare against the persisted content hash;
10. rebuild dependent data only when the normalized content changed.

Minimum extraction rule:
- code examples SHALL be preserved as code blocks when possible.

The runtime SHALL NOT store raw HTML as the canonical retrieval payload for official knowledge.

### 13.10 Chunking and embedding contract

Normalized markdown SHALL be split into retrieval chunks.

Minimum chunking rules:
- target size SHOULD be approximately `500–1000` tokens;
- fenced code blocks SHALL NOT be split in the middle unless absolutely unavoidable;
- headings SHOULD remain attached to the nearest relevant text/code;
- each chunk SHALL preserve traceability back to document URL and position.

Minimum embedding rules:
- embeddings SHALL be created only for current active chunks;
- unchanged normalized content SHALL NOT trigger unnecessary re-embedding;
- changed normalized content SHALL trigger chunk rebuild and embedding refresh;
- stale superseded chunks SHALL NOT remain active for retrieval.

### 13.11 Retrieval contract

Retrieval SHALL live outside `route.ts` and SHALL be executed by dedicated backend modules.

Minimum retrieval behavior:
- semantic search over active chunks;
- bounded top-K selection;
- optional reranking when explicitly implemented;
- prompt injection through the prompt/policy layer, not through inline route logic;
- traceable citation metadata including source URL and title when available.

If retrieval returns no relevant chunks, the system SHALL behave honestly and SHALL NOT pretend that supporting source evidence was found.

### 13.12 Budget-aware embeddings policy

The system SHALL stay budget-aware for embeddings and retrieval.
Minimum rules:
- at `>= 70%` relevant embedding/DB budget -> reduce retrieval and ingest intensity;
- at `>= 90%` relevant embedding/DB budget -> stop new ingest until the system returns below safe band;
- chat correctness and safety SHALL remain protected.

### 13.13 Retention policy

Retention SHALL be layer-specific.
Minimum BotCow v1 rules:
- temporary embeddings and temporary retrieval derivatives MAY use TTL `7 days`;
- official knowledge embeddings SHALL NOT use ordinary TTL;
- official knowledge embeddings MAY be cleaned only by LRU-style pressure rules;
- cleanup cadence SHOULD be at least every `24h` for TTL-governed temporary data.

### 13.14 RAG degradation order

Under pressure, the system SHALL degrade in this order:
1. optional enrichments;
2. search breadth and rerank depth;
3. chunk count / overlap / retrieval depth;
4. new ingest / new embedding creation;
5. temporary derivative retention.

### 13.15 Protected behavior under pressure

As long as the service still works, the following SHALL stay protected:
- ownership/control checks for dangerous routes;
- canonical conversation persistence;
- core chat handling;
- deterministic error mapping.

## 14. Cost and Budget Policy

### 14.1 General rule

BotCow SHALL avoid waste, but SHALL NOT cripple itself with arbitrary business limits on ordinary chat size.

### 14.2 No artificial chat-size business cap

There SHALL be no arbitrary business cap on chat length just for convenience.
Only these may constrain chat execution:
- provider hard limits;
- runtime safety limits;
- context compaction rules;
- explicit owner-approved limits.

### 14.3 External budget thresholds

The system SHALL monitor at least these budget families when possible:
- model token consumption;
- DB usage;
- storage usage;
- embeddings count / vector budget;
- GitHub quota pressure where relevant;
- Vercel quota pressure where relevant;
- async queue pressure where relevant.

Threshold semantics:
- `>= 70%` = warning / optimization mode
- `>= 90%` = aggressive degradation mode

### 14.4 No budget-triggered chat closure rule

External budget pressure alone SHALL NOT auto-close the conversation.
Budget pressure SHALL first degrade optional and expensive capabilities.

### 14.5 Provider hard failure rule

If a specific provider or feature becomes unavailable, the runtime MAY reject that specific operation, but SHALL NOT pretend success.

## 15. Context Size and Compaction Policy

### 15.1 Compaction required

Because BotCow is not supposed to enforce a small artificial chat limit, the core SHALL support context compaction / summarization / trimming policy.

### 15.2 Forbidden absence

Running an unlimited-growth conversation without any compaction strategy is forbidden in core.

### 15.3 Summary quality rule

Compaction SHALL preserve actionable coding context, repo/task state, and recent tool outcomes.
It SHALL NOT silently erase the facts needed for the current task.

## 16. Runtime Capability Policy

### 16.1 Lazy client creation

OpenAI client creation SHALL stay lazy and SHALL NOT fail at import/build time.

### 16.2 Runtime reasoning check

Reasoning SHALL be sent only when:
- the model allows it;
- the runtime allows it;
- the selected state path supports it.

### 16.3 Suppression logging

If reasoning is suppressed, the runtime SHALL record the suppression reason in logs/diagnostics.

## 17. Logging and Observability

### 17.1 Required logging

The core SHALL log at least:
- request/turn correlation ids;
- model chosen;
- model reason;
- requested reasoning;
- sent reasoning;
- suppression reason when applicable;
- conversation id;
- previous response id;
- response id;
- tool rounds;
- tool success/failure class;
- duration;
- usage when available;
- RAG source key when retrieval or ingest is involved;
- knowledge job id when ingest/bootstrap is involved;
- document canonical URL when a document is fetched or processed;
- document status transitions;
- HTTP status class for document fetches;
- normalized content hash when computed;
- chunk count produced from a document;
- embedding count produced for a document;
- retrieval hit count;
- retrieval source count;
- fetch duration and embed duration when available.

### 17.2 Secret safety

Secrets SHALL never appear in logs, API responses, prompts, or normalized chat output.

## 18. Tests

### 18.1 Contract tests mandatory

The replacement core SHALL include contract tests.
At minimum:
- route contract tests;
- assistant orchestration contract tests;
- model routing tests;
- runtime capability tests;
- response normalization tests;
- seed manifest parsing tests;
- URL canonicalization tests;
- document lifecycle/status transition tests;
- retrieval contract tests.

### 18.2 Knowledge bootstrap and ingest tests

There SHALL be tests that detect regression of:
- bootstrap from an empty knowledge database;
- deterministic queue creation from seed manifest;
- duplicate URL elimination;
- out-of-scope URL rejection;
- extraction preserving code blocks;
- normalized markdown hash stability;
- unchanged content not triggering unnecessary re-embedding;
- changed content triggering chunk rebuild and embedding refresh;
- resumable job continuation after partial interruption;
- failed document status recording;
- deleted/inaccessible document invalidation behavior.

### 18.3 Golden core protection tests

There SHALL be tests that detect regression of:
- route/assistant contract;
- reasoning suppression behavior;
- `nano` hard override for risky tasks;
- self-rewrite escalation to full model;
- normalized chat response shape.

## 19. Migration Rules

### 19.1 Core-first migration

Migration SHALL happen in this order:
1. replace golden core;
2. make surrounding code compile against it;
3. make surrounding code pass tests against it;
4. only then optimize or extend behavior.

### 19.2 Compatibility discipline

Compatibility with old code is allowed only if it does not distort the new core contract.
Legacy behavior that conflicts with this strong spec SHALL be removed.

### 19.3 Explicit known cleanup targets from existing project

The replacement core SHALL remove or fix at minimum these existing weaknesses where present:
- giant system prompt embedded in `route.ts`;
- route/assistant contract drift;
- raw completion response compatibility as public contract;
- lack of explicit prompt layer;
- lack of explicit compaction policy;
- lack of retry policy for transient runtime failures;
- lack of self-rewrite-aware router inputs.

## 20. Acceptance Criteria

BotCow core v1 is accepted only if all of the following are true:

1. `POST /api/chat` uses the canonical replacement runtime.
2. `route.ts` is thin and no longer contains the giant monolithic prompt.
3. Core uses Responses API as canonical path.
4. Public chat response is normalized JSON, not raw legacy completion.
5. Router uses `gpt-5.4 / mini / nano` and `none/low/medium/high/xhigh`.
6. Self-rewrite tasks touching core files are forcibly escalated.
7. External budget pressure triggers degradation, not fake success and not silent contract weakening.
8. Ingest is event-driven only.
9. Blind cron ingest is absent.
10. Temporary embeddings use TTL policy; official knowledge embeddings do not use ordinary TTL.
11. Golden core can be installed without modification and surrounding code can be adapted to it.
12. Contract tests pass.
13. An owner-triggered bootstrap can populate an empty knowledge database from the repository seed manifest.
14. Bootstrap creates deterministic source, job, document, and chunk records.
15. Each ready knowledge document has normalized markdown, chunk records, and embeddings.
16. Re-running bootstrap or batch ingest is idempotent and resumable.
17. Unchanged normalized content does not trigger unnecessary re-embedding.
18. Changed normalized content triggers chunk rebuild and embedding refresh.
19. Retrieval is executed outside `route.ts` and is wired into assistant orchestration.
20. Retrieval returns only active chunks from approved knowledge sources.
21. If retrieval finds no support, the runtime behaves honestly and does not pretend source-backed certainty.
22. Cleanup cron, if used, performs maintenance only and does not become the primary ingest driver.

## 21. Explicit Forbidden Behaviors

The following are explicitly forbidden:
- editing owner-supplied golden core files without direct permission;
- putting giant policy text back into `route.ts`;
- exposing raw provider payloads as the public chat contract;
- routing self-rewrite of core to cheap/light models by default;
- using `nano` for risky coding/debug tasks;
- using cron as the primary ingest driver;
- silently weakening validation, guardrails, or routing policy to simplify migration;
- claiming success when tools/runtime/provider actually failed;
- ingesting out-of-scope URLs into an official knowledge source;
- treating raw HTML as the canonical retrieval payload for official knowledge;
- splitting code examples carelessly such that code meaning is materially degraded;
- re-embedding unchanged normalized content without cause;
- silently leaving superseded chunks active after content replacement;
- wiring retrieval logic directly into `route.ts`;
- pretending that RAG support exists when retrieval returned no supporting chunks;
- using cleanup cron as a disguised primary ingest driver.

## 22. Implementation Note for the Integrating Bot

When this spec is given to BotCow together with owner-supplied golden core files, the bot SHALL perform this exact mode of work:

1. read this spec;
2. read the supplied golden core files;
3. install them unchanged;
4. identify compile/runtime mismatches around them;
5. adapt neighboring code to the supplied core;
6. run tests / CI when available;
7. report only factual incompatibilities or remaining gaps.

The bot SHALL NOT negotiate the spec downward.

### 22.1 Implementation note for knowledge bootstrap

When the repository contains an approved seed manifest for an official knowledge source, the bot SHALL perform this exact mode of work:

1. read this spec;
2. read the declared seed manifest;
3. validate and canonicalize seed URLs against the approved source scope;
4. create or reuse the official knowledge source record;
5. create or reuse a bootstrap job record;
6. enqueue missing or stale documents deterministically;
7. process documents in bounded batches;
8. fetch and extract the main article content;
9. normalize extracted content into stable markdown;
10. compute content hashes from normalized markdown;
11. create or refresh chunks and embeddings only when needed;
12. persist document, chunk, and job statuses honestly;
13. resume safely after interruption when more work remains;
14. report only factual progress, failures, and remaining gaps.

The bot SHALL NOT claim that the knowledge base exists or is current unless the persisted source/job/document states support that claim.
