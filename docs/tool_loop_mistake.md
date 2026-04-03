ТЗ

### Цель

Убрать зависания в tool loop при переходе на Responses API. Причина не в самом лимите циклов, а в оркестрации: в Responses API tool call приходит как `function_call` с `arguments` в виде JSON-строки и `call_id`, а ответ tool нужно возвращать как `function_call_output` с тем же `call_id`. Для multi-turn можно использовать `previous_response_id`; для более постоянного состояния есть `conversation`, где items автоматически добавляются в разговор. У assistant-сообщений также есть `phase`, и для GPT-5.3-codex+ его нужно сохранять и пересылать дальше, иначе качество может падать. ([OpenAI Developers][1])

---

## 1) `src/backend/assistant.ts`

### 1.1. Новый контракт loop

Сделать loop **fail-fast**, а не “крутим до `maxToolLoops`”.

Ввести константы:

```ts
const MAX_TOOL_LOOPS = 12;
const MAX_TOTAL_TOOL_CALLS = 24;
const MAX_SAME_FINGERPRINT_IN_ROW = 2;
const MAX_NO_PROGRESS_ROUNDS = 2;
const TOOL_TIMEOUT_MS = 20000;
```

Дополнительно в `responses.create(...)`:

```ts
parallel_tool_calls: false
```

Параметр `parallel_tool_calls` в Responses API есть; его можно выключить и держать один tool call за раунд, чтобы поведение было детерминированным. В объекте function tool указывать `strict: true`. ([OpenAI Developers][1])

### 1.2. Stop conditions

Немедленно завершать текущий run с internal code, если произошло одно из:

* `invalid_tool_args_json`
* `invalid_tool_args_schema`
* `unknown_tool`
* `tool_timeout`
* `tool_execution_failed`
* `repeated_tool_call`
* `no_progress_abort`
* `tool_budget_exceeded`
* `no_actionable_output`
* `tool_loop_limit`

### 1.3. Parse arguments

Запрещено делать fallback `args = {}`.

Нужно так:

```ts
function safeParseToolArgs(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}
```

Если parse failed:

* не запускать tool,
* не продолжать loop,
* записать лог,
* завершить run с `invalid_tool_args_json`.

Это важно, потому что в Responses API `arguments` у `function_call` — именно JSON-строка; подставлять `{}` значит менять смысл вызова. ([OpenAI Developers][1])

### 1.4. Runtime schema validation

После `JSON.parse` валидировать args через вашу runtime-schema:

* required fields
* type checks
* `additionalProperties: false`, где нужно

Если schema validation failed:

* abort `invalid_tool_args_schema`

### 1.5. Fingerprint повтора

Добавить fingerprint:

```ts
type ToolResultClass =
  | "ok"
  | "invalid_tool_args_json"
  | "invalid_tool_args_schema"
  | "unknown_tool"
  | "tool_timeout"
  | "tool_execution_failed";

function makeToolFingerprint(
  toolName: string,
  args: unknown,
  prevResultClass: ToolResultClass | null
): string {
  return sha256(
    toolName + "\n" +
    stableStringify(args) + "\n" +
    (prevResultClass ?? "none")
  );
}
```

Правило:

* если fingerprint повторился **2 раза подряд** → abort `repeated_tool_call`

### 1.6. No-progress detector

Считать, что в раунде **нет прогресса**, если одновременно:

* не было успешного tool result,
* не появился финальный assistant message,
* fingerprint не изменился.

Если `noProgressRounds >= 2` → abort `no_progress_abort`.

### 1.7. Tool execution

Tool запускать только через wrapper:

```ts
async function runToolWithTimeout(...) { ... }
```

На любой exception/timeout:

* не отправлять модели “попробуй ещё раз” бесконечно,
* abort с кодом `tool_timeout` или `tool_execution_failed`.

### 1.8. Возврат результата tool в модель

При успешном tool вы обязаны передавать в следующий запрос item вида:

```ts
{
  type: "function_call_output",
  call_id: toolCall.call_id,
  output: JSON.stringify(result)
}
```

`call_id` должен совпадать с тем, который пришёл в `function_call`. Это базовый контракт Responses API. ([OpenAI Developers][1])

---

## 2) `src/backend/responses.ts`

### 2.1. Не выбрасывать assistant history

Сейчас нельзя выбрасывать assistant/function_call/reasoning items.

Если вы ведёте state вручную:

* сохранять `assistant` messages,
* сохранять `function_call`,
* сохранять `function_call_output`,
* сохранять reasoning items, если они пришли.

В официальном cookbook прямо указано: при ручной оркестрации нужно сохранять reasoning и function-call responses; иначе модель теряет ход работы, а API может ошибаться. Responses API stateful; reasoning items сохраняются между шагами, а при `previous_response_id` прошлые reasoning items доступны автоматически. ([OpenAI Developers][2])

### 2.2. Предпочтительный путь

Лучше перевести оркестрацию на:

```ts
previous_response_id
```

вместо ручной склейки истории, где это возможно.

Но:

* `developer/system instructions` надо передавать заново в каждом новом response,
* они **не переносятся автоматически** через `previous_response_id`. ([OpenAI Developers][1])

### 2.3. Если используете assistant messages вручную

Сохранять поле:

```ts
phase: "commentary" | "final_answer"
```

и пересылать его дальше на follow-up. Документация прямо предупреждает: для моделей вроде `gpt-5.3-codex` и новее dropping `phase` может ухудшать работу. ([OpenAI Developers][1])

---

## 3) `src/backend/log.ts`

Сделать `log.ts` не no-op.

Минимальный structured log на каждый раунд:

```ts
{
  traceId,
  userTurnId,
  responseId,
  previousResponseId,
  round,
  totalToolCalls,
  toolName,
  toolCallId,
  argsHash,
  argsParseOk,
  schemaValid,
  toolLatencyMs,
  toolResultClass,
  assistantPhase,
  stopReason,
  usage
}
```

Хранить ещё ring buffer последних 20 событий run-а.

---

## 4) Внешние ошибки

### Что нельзя

Нельзя отдавать наружу:

* `Assistant did not produce a final answer within tool loop limit`
* stack trace
* внутренние enum-коды

### Что надо

Наружный ответ:

```json
{
  "code": "assistant_run_failed",
  "message": "Не удалось завершить действие автоматически. Попробуйте ещё раз."
}
```

В логах:

```json
{
  "internal_code": "tool_loop_limit"
}
```

---

## 5) Acceptance criteria

Считать задачу выполненной, если проходят тесты:

1. **Bad JSON args**
   Модель вернула битый JSON → run останавливается сразу, tool не запускается.

2. **Unknown tool**
   Модель вызвала несуществующий tool → run останавливается сразу.

3. **Repeated tool call**
   Один и тот же `tool + args` два раза подряд → abort `repeated_tool_call`.

4. **Tool timeout**
   Tool завис → abort `tool_timeout`, наружу уходит нормальная ошибка.

5. **No progress**
   Два раунда подряд без изменения fingerprint и без успешного результата → abort `no_progress_abort`.

6. **State retention**
   При follow-up модель не забывает прошлый tool reasoning, assistant history не режется.

7. **Phase retention**
   `assistant.phase` сохраняется и пересылается дальше. ([OpenAI Developers][1])

---

## 6) Приоритет внедрения

Порядок такой:

1. fail-fast на parse/schema/unknown tool/timeout
2. duplicate + no-progress guards
3. structured logging
4. history через `previous_response_id`
5. только потом думать о поднятии лимитов

**Поднимать `MAX_TOOL_LOOPS` до 16–20 сейчас не надо.**
Сначала цикл должен стать конечным по логике, а не по аварийному предохранителю.

Ниже скелет assistant.ts, который можно почти напрямую превращать в код.
Контракт такой: модель может вернуть function_call; ваш код должен выполнить tool и отправить обратно function_call_output с тем же call_id; для продолжения цепочки удобно использовать previous_response_id. Если идёте этим путём, instructions надо передавать заново на каждом шаге. parallel_tool_calls можно отключить для детерминированного цикла, а assistant.phase лучше сохранять и прокидывать дальше.

// src/backend/assistant.ts

type ToolResultClass =
  | "ok"
  | "invalid_tool_args_json"
  | "invalid_tool_args_schema"
  | "unknown_tool"
  | "tool_timeout"
  | "tool_execution_failed";

type RunOk = {
  ok: true;
  text: string;
  responseId: string;
  phase?: "commentary" | "final_answer";
};

type RunErr = {
  ok: false;
  publicCode: "assistant_run_failed";
  publicMessage: string;
  internalCode:
    | "invalid_tool_args_json"
    | "invalid_tool_args_schema"
    | "unknown_tool"
    | "tool_timeout"
    | "tool_execution_failed"
    | "repeated_tool_call"
    | "no_progress_abort"
    | "tool_budget_exceeded"
    | "no_actionable_output"
    | "tool_loop_limit";
  responseId?: string;
};

const MAX_TOOL_LOOPS = 12;
const MAX_TOTAL_TOOL_CALLS = 24;
const MAX_SAME_FINGERPRINT_IN_ROW = 2;
const MAX_NO_PROGRESS_ROUNDS = 2;
const TOOL_TIMEOUT_MS = 20_000;

export async function runAssistantTurn(params: {
  model: string;
  userInput: string;
  previousResponseId?: string;
  instructions: string;          // developer/system text; always resend
  toolRegistry: Record<string, ToolHandler>;
}): Promise<RunOk | RunErr> {
  let previousResponseId = params.previousResponseId;
  let totalToolCalls = 0;
  let noProgressRounds = 0;
  let lastFingerprint: string | null = null;
  let sameFingerprintInRow = 0;
  let lastToolResultClass: ToolResultClass | null = null;

  // incremental input for the next response.create
  let pendingInputItems: any[] = [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: params.userInput }],
    },
  ];

  for (let round = 1; round <= MAX_TOOL_LOOPS; round++) {
    logInfo("assistant_round_start", {
      round,
      previousResponseId,
      totalToolCalls,
    });

    const response = await openai.responses.create({
      model: params.model,
      instructions: params.instructions,
      previous_response_id: previousResponseId,
      input: pendingInputItems,
      parallel_tool_calls: false,
      tools: buildStrictToolsSchema(params.toolRegistry), // each function tool has strict: true
    });

    previousResponseId = response.id;
    pendingInputItems = [];

    const finalMsg = extractFinalAssistantMessage(response);
    const toolCalls = extractFunctionCalls(response);

    logInfo("assistant_round_response", {
      round,
      responseId: response.id,
      toolCalls: toolCalls.length,
      hasFinalMessage: Boolean(finalMsg?.text),
      phase: finalMsg?.phase,
      usage: response.usage ?? null,
    });

    // case 1: got final answer and no tools requested
    if (finalMsg?.text && toolCalls.length === 0) {
      return {
        ok: true,
        text: finalMsg.text,
        responseId: response.id,
        phase: finalMsg.phase,
      };
    }

    // case 2: neither final message nor tools => invalid state
    if (toolCalls.length === 0) {
      return abort("no_actionable_output", response.id);
    }

    // hard budget on total tool calls
    if (totalToolCalls + toolCalls.length > MAX_TOTAL_TOOL_CALLS) {
      return abort("tool_budget_exceeded", response.id);
    }

    let progressThisRound = false;

    for (const call of toolCalls) {
      // 1) known tool?
      const tool = params.toolRegistry[call.name];
      if (!tool) {
        logWarn("assistant_unknown_tool", {
          responseId: response.id,
          toolName: call.name,
          callId: call.call_id,
        });
        return abort("unknown_tool", response.id);
      }

      // 2) parse JSON args
      const parsed = safeParseToolArgs(call.arguments);
      if (!parsed.ok) {
        logWarn("assistant_invalid_tool_args_json", {
          responseId: response.id,
          toolName: call.name,
          callId: call.call_id,
          rawArgs: call.arguments,
        });
        return abort("invalid_tool_args_json", response.id);
      }

      // 3) schema validate
      const valid = tool.validate ? tool.validate(parsed.value) : { ok: true };
      if (!valid.ok) {
        logWarn("assistant_invalid_tool_args_schema", {
          responseId: response.id,
          toolName: call.name,
          callId: call.call_id,
          issues: valid.issues ?? [],
        });
        return abort("invalid_tool_args_schema", response.id);
      }

      // 4) repeated fingerprint guard
      const fingerprint = makeToolFingerprint(
        call.name,
        parsed.value,
        lastToolResultClass
      );

      if (fingerprint === lastFingerprint) {
        sameFingerprintInRow += 1;
      } else {
        sameFingerprintInRow = 1;
      }
      lastFingerprint = fingerprint;

      if (sameFingerprintInRow >= MAX_SAME_FINGERPRINT_IN_ROW) {
        logWarn("assistant_repeated_tool_call", {
          responseId: response.id,
          toolName: call.name,
          callId: call.call_id,
          fingerprint,
          sameFingerprintInRow,
        });
        return abort("repeated_tool_call", response.id);
      }

      // 5) execute tool with timeout
      const startedAt = Date.now();
      const result = await runToolWithTimeout(tool, parsed.value, TOOL_TIMEOUT_MS);
      const latencyMs = Date.now() - startedAt;

      if (!result.ok) {
        lastToolResultClass = result.code;

        logWarn("assistant_tool_failed", {
          responseId: response.id,
          toolName: call.name,
          callId: call.call_id,
          latencyMs,
          code: result.code,
          error: result.error ?? null,
        });

        if (result.code === "tool_timeout") {
          return abort("tool_timeout", response.id);
        }
        return abort("tool_execution_failed", response.id);
      }

      lastToolResultClass = "ok";
      totalToolCalls += 1;
      progressThisRound = true;

      // 6) append tool output for next response.create
      pendingInputItems.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(result.output),
      });

      logInfo("assistant_tool_ok", {
        responseId: response.id,
        toolName: call.name,
        callId: call.call_id,
        latencyMs,
      });
    }

    // 7) no-progress guard
    if (progressThisRound) {
      noProgressRounds = 0;
    } else {
      noProgressRounds += 1;
    }

    if (noProgressRounds >= MAX_NO_PROGRESS_ROUNDS) {
      logWarn("assistant_no_progress_abort", {
        responseId: response.id,
        noProgressRounds,
      });
      return abort("no_progress_abort", response.id);
    }

    // continue loop with only new items (tool outputs)
  }

  return abort("tool_loop_limit", previousResponseId);
}

/* ---------------- helpers ---------------- */

function abort(code: RunErr["internalCode"], responseId?: string): RunErr {
  return {
    ok: false,
    publicCode: "assistant_run_failed",
    publicMessage: "Не удалось завершить действие автоматически. Попробуйте ещё раз.",
    internalCode: code,
    responseId,
  };
}

function safeParseToolArgs(raw: string):
  | { ok: true; value: unknown }
  | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

function makeToolFingerprint(
  toolName: string,
  args: unknown,
  prevResultClass: ToolResultClass | null
): string {
  return sha256(
    `${toolName}\n${stableStringify(args)}\n${prevResultClass ?? "none"}`
  );
}

async function runToolWithTimeout(
  tool: ToolHandler,
  args: unknown,
  timeoutMs: number
): Promise<
  | { ok: true; output: unknown }
  | { ok: false; code: "tool_timeout" | "tool_execution_failed"; error?: string }
> {
  try {
    const result = await promiseWithTimeout(tool.execute(args), timeoutMs);
    return { ok: true, output: result };
  } catch (err: any) {
    if (err?.name === "TimeoutError") {
      return { ok: false, code: "tool_timeout", error: err.message };
    }
    return { ok: false, code: "tool_execution_failed", error: String(err?.message ?? err) };
  }
}

function extractFunctionCalls(response: any): Array<{
  name: string;
  arguments: string;
  call_id: string;
}> {
  return (response.output ?? []).filter((item: any) => item.type === "function_call");
}

function extractFinalAssistantMessage(response: any):
  | { text: string; phase?: "commentary" | "final_answer" }
  | null {
  const msg = (response.output ?? []).find((item: any) => item.type === "message");
  if (!msg) return null;

  const text = (msg.content ?? [])
    .filter((c: any) => c.type === "output_text")
    .map((c: any) => c.text)
    .join("");

  if (!text) return null;
  return { text, phase: msg.phase };
}

Что важно не забыть вокруг этого кода:
В следующий responses.create передавайте только новые items плюс previous_response_id; tool output должен идти как function_call_output с тем же call_id.
Если сохраняете state вручную, не режьте assistant/function-call/reasoning items; cookbook отдельно советует хранить reasoning и function-call chain, иначе multi-step tool flow деградирует.
instructions не наследуются автоматически через previous_response_id, поэтому их надо пересылать на каждом шаге. phase у assistant message тоже лучше сохранять и переносить дальше.

responses.ts: безопасная обёртка вокруг Responses API.
Ключевые моменты: для продолжения цикла используйте previous_response_id; instructions передавайте каждый раз заново; function_call_output возвращайте с тем же call_id; если вручную переносите assistant history, сохраняйте phase.

// src/backend/responses.ts

import OpenAI from "openai";

export type AssistantPhase = "commentary" | "final_answer";

export type InputItem =
  | {
      type: "message";
      role: "user" | "assistant" | "system" | "developer";
      content: Array<{ type: "input_text"; text: string }>;
      phase?: AssistantPhase; // only for assistant
    }
  | {
      type: "function_call_output";
      call_id: string;
      output: string;
    };

export type ExtractedFunctionCall = {
  id?: string;
  call_id: string;
  name: string;
  arguments: string;
};

export type ExtractedAssistantMessage = {
  id?: string;
  role: "assistant";
  phase?: AssistantPhase;
  text: string;
};

export type CreateResponseParams = {
  client: OpenAI;
  model: string;
  instructions: string;
  input: InputItem[];
  previousResponseId?: string;
  tools?: any[];
  metadata?: Record<string, string>;
};

export async function createModelResponse(params: CreateResponseParams) {
  return params.client.responses.create({
    model: params.model,
    instructions: params.instructions,
    previous_response_id: params.previousResponseId,
    input: params.input,
    tools: params.tools ?? [],
    parallel_tool_calls: false,
    metadata: params.metadata,
  });
}

export function extractFunctionCalls(response: any): ExtractedFunctionCall[] {
  return (response.output ?? [])
    .filter((item: any) => item?.type === "function_call")
    .map((item: any) => ({
      id: item.id,
      call_id: item.call_id,
      name: item.name,
      arguments: item.arguments,
    }));
}

export function extractAssistantMessages(response: any): ExtractedAssistantMessage[] {
  return (response.output ?? [])
    .filter((item: any) => item?.type === "message" && item?.role === "assistant")
    .map((item: any) => ({
      id: item.id,
      role: "assistant",
      phase: item.phase,
      text: (item.content ?? [])
        .filter((c: any) => c?.type === "output_text")
        .map((c: any) => c.text)
        .join(""),
    }))
    .filter((m: ExtractedAssistantMessage) => m.text.length > 0);
}

export function extractFinalAssistantMessage(response: any): ExtractedAssistantMessage | null {
  const msgs = extractAssistantMessages(response);
  if (!msgs.length) return null;

  // prefer explicit final_answer
  const explicitFinal = msgs.find((m) => m.phase === "final_answer");
  if (explicitFinal) return explicitFinal;

  // fallback: last assistant text message
  return msgs[msgs.length - 1] ?? null;
}

export function makeUserTextItem(text: string): InputItem {
  return {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text }],
  };
}

export function makeAssistantTextItem(
  text: string,
  phase?: AssistantPhase
): InputItem {
  return {
    type: "message",
    role: "assistant",
    phase,
    content: [{ type: "input_text", text }],
  };
}

export function makeFunctionCallOutputItem(
  callId: string,
  output: unknown
): InputItem {
  return {
    type: "function_call_output",
    call_id: callId,
    output: typeof output === "string" ? output : JSON.stringify(output),
  };
}

export function buildStrictFunctionTools(registry: Record<string, any>): any[] {
  return Object.entries(registry).map(([name, tool]) => ({
    type: "function",
    name,
    description: tool.description ?? "",
    parameters: tool.parameters ?? {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    strict: true,
  }));
}

export function responseUsage(response: any) {
  return {
    inputTokens: response?.usage?.input_tokens ?? null,
    outputTokens: response?.usage?.output_tokens ?? null,
    totalTokens: response?.usage?.total_tokens ?? null,
  };
}

Минимальная связка в assistant.ts:

const response = await createModelResponse({
  client: openai,
  model,
  instructions,
  previousResponseId,
  input: pendingInputItems,
  tools: buildStrictFunctionTools(toolRegistry),
});

logInfo("assistant_round_response", {
  traceId,
  responseId: response.id,
  previousResponseId,
  round,
  usage: responseUsage(response),
});

const toolCalls = extractFunctionCalls(response);
const finalMsg = extractFinalAssistantMessage(response);

И ещё 2 правила:
previous_response_id — основной путь для продолжения loop.
long-lived state без ручной склейки, поэтому лучше перейти на Conversations API: там хранятся messages, tool calls и tool outputs.

Мнимальный правильный набор тестов.

Responses API loop у вас должен проверять четыре вещи:

1. `function_call` → tool → `function_call_output` с тем же `call_id`;
2. продолжение через `previous_response_id`;
3. повторная передача `instructions` на каждом шаге;
4. сохранение `assistant.phase`, если вы переносите assistant history вручную. ([OpenAI Developers][1])

## 1. Что тестировать обязательно

### `assistant.test.ts`

* bad JSON args → abort `invalid_tool_args_json`
* schema invalid → abort `invalid_tool_args_schema`
* unknown tool → abort `unknown_tool`
* tool timeout → abort `tool_timeout`
* tool throw → abort `tool_execution_failed`
* identical fingerprint 2 раза подряд → abort `repeated_tool_call`
* 2 no-progress rounds → abort `no_progress_abort`
* общий budget tool calls exceeded → abort `tool_budget_exceeded`
* normal path: `function_call` → tool → `function_call_output` → final answer
* наружу уходит нормальная ошибка, не internal text

### `responses.test.ts`

* `extractFunctionCalls()` правильно достаёт `name`, `arguments`, `call_id`
* `extractFinalAssistantMessage()` предпочитает `phase="final_answer"`
* `makeFunctionCallOutputItem()` сохраняет тот же `call_id`
* `createModelResponse()` всегда передаёт:

  * `previous_response_id`
  * `instructions`
  * `parallel_tool_calls: false`

### `log.test.ts`

* пишет structured event
* ring buffer режет старые записи
* `getRecentRunEvents()` возвращает последние N

---

## 2. Минимальные unit-тесты

### `assistant.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { runAssistantTurn } from "../src/backend/assistant";

function makeOpenAIStub(sequence: any[]) {
  return {
    responses: {
      create: vi.fn()
        .mockImplementation(() => Promise.resolve(sequence.shift())),
    },
  };
}

describe("runAssistantTurn", () => {
  it("aborts on invalid JSON tool args", async () => {
    const openai = makeOpenAIStub([
      {
        id: "resp_1",
        output: [
          {
            type: "function_call",
            call_id: "call_1",
            name: "getWeather",
            arguments: '{"city":', // bad json
          },
        ],
      },
    ]);

    const result = await runAssistantTurn({
      openai,
      model: "gpt-5.4",
      userInput: "weather",
      instructions: "test",
      toolRegistry: {
        getWeather: {
          description: "x",
          parameters: {},
          execute: vi.fn(),
          validate: () => ({ ok: true }),
        },
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.internalCode).toBe("invalid_tool_args_json");
      expect(result.publicCode).toBe("assistant_run_failed");
    }
  });

  it("aborts on unknown tool", async () => {
    const openai = makeOpenAIStub([
      {
        id: "resp_1",
        output: [
          {
            type: "function_call",
            call_id: "call_1",
            name: "doesNotExist",
            arguments: "{}",
          },
        ],
      },
    ]);

    const result = await runAssistantTurn({
      openai,
      model: "gpt-5.4",
      userInput: "x",
      instructions: "test",
      toolRegistry: {},
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.internalCode).toBe("unknown_tool");
  });

  it("aborts on repeated identical tool call", async () => {
    const openai = makeOpenAIStub([
      {
        id: "resp_1",
        output: [
          {
            type: "function_call",
            call_id: "call_1",
            name: "getWeather",
            arguments: '{"city":"Berlin"}',
          },
        ],
      },
      {
        id: "resp_2",
        output: [
          {
            type: "function_call",
            call_id: "call_2",
            name: "getWeather",
            arguments: '{"city":"Berlin"}',
          },
        ],
      },
    ]);

    const execute = vi.fn().mockResolvedValue({ temp: 20 });

    const result = await runAssistantTurn({
      openai,
      model: "gpt-5.4",
      userInput: "x",
      instructions: "test",
      toolRegistry: {
        getWeather: {
          description: "x",
          parameters: {},
          execute,
          validate: () => ({ ok: true }),
        },
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.internalCode).toBe("repeated_tool_call");
  });

  it("returns final answer after tool output round-trip", async () => {
    const openai = makeOpenAIStub([
      {
        id: "resp_1",
        output: [
          {
            type: "function_call",
            call_id: "call_1",
            name: "getWeather",
            arguments: '{"city":"Berlin"}',
          },
        ],
      },
      {
        id: "resp_2",
        output: [
          {
            type: "message",
            role: "assistant",
            phase: "final_answer",
            content: [{ type: "output_text", text: "20°C" }],
          },
        ],
      },
    ]);

    const execute = vi.fn().mockResolvedValue({ temp: 20 });

    const result = await runAssistantTurn({
      openai,
      model: "gpt-5.4",
      userInput: "weather in Berlin",
      instructions: "test",
      toolRegistry: {
        getWeather: {
          description: "x",
          parameters: {},
          execute,
          validate: () => ({ ok: true }),
        },
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe("20°C");
      expect(result.phase).toBe("final_answer");
    }
  });

  it("passes previous_response_id and resends instructions on follow-up call", async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({
        id: "resp_1",
        output: [
          {
            type: "function_call",
            call_id: "call_1",
            name: "getWeather",
            arguments: '{"city":"Berlin"}',
          },
        ],
      })
      .mockResolvedValueOnce({
        id: "resp_2",
        output: [
          {
            type: "message",
            role: "assistant",
            phase: "final_answer",
            content: [{ type: "output_text", text: "done" }],
          },
        ],
      });

    const openai = { responses: { create } };

    await runAssistantTurn({
      openai,
      model: "gpt-5.4",
      userInput: "x",
      instructions: "DEV_INSTR",
      toolRegistry: {
        getWeather: {
          description: "x",
          parameters: {},
          execute: vi.fn().mockResolvedValue({ ok: true }),
          validate: () => ({ ok: true }),
        },
      },
    });

    expect(create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        previous_response_id: "resp_1",
        instructions: "DEV_INSTR",
      })
    );
  });
});
```

---

## 3. `responses.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  extractFunctionCalls,
  extractFinalAssistantMessage,
  makeFunctionCallOutputItem,
} from "../src/backend/responses";

describe("responses helpers", () => {
  it("extracts function calls", () => {
    const response = {
      output: [
        {
          type: "function_call",
          call_id: "call_123",
          name: "searchDocs",
          arguments: '{"q":"abc"}',
        },
      ],
    };

    expect(extractFunctionCalls(response)).toEqual([
      {
        id: undefined,
        call_id: "call_123",
        name: "searchDocs",
        arguments: '{"q":"abc"}',
      },
    ]);
  });

  it("prefers final_answer phase", () => {
    const response = {
      output: [
        {
          type: "message",
          role: "assistant",
          phase: "commentary",
          content: [{ type: "output_text", text: "thinking" }],
        },
        {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          content: [{ type: "output_text", text: "done" }],
        },
      ],
    };

    expect(extractFinalAssistantMessage(response)).toEqual({
      id: undefined,
      role: "assistant",
      phase: "final_answer",
      text: "done",
    });
  });

  it("builds function_call_output with same call_id", () => {
    expect(makeFunctionCallOutputItem("call_123", { ok: true })).toEqual({
      type: "function_call_output",
      call_id: "call_123",
      output: JSON.stringify({ ok: true }),
    });
  });
});
```

---

## 4. `log.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  logInfo,
  getRecentRunEvents,
  clearRecentRunEvents,
} from "../src/backend/log";

describe("log ring buffer", () => {
  it("stores recent events", () => {
    clearRecentRunEvents();

    logInfo("evt1", { responseId: "r1" });
    logInfo("evt2", { responseId: "r2" });

    const events = getRecentRunEvents();
    expect(events.length).toBe(2);
    expect(events[0].event).toBe("evt1");
    expect(events[1].event).toBe("evt2");
  });
});
```

---

## 5. Один integration-тест обязателен

Именно он проверяет реальный контракт loop:

* 1-й response возвращает `function_call`
* ваш код запускает tool
* 2-й request уходит с `previous_response_id` и `function_call_output`
* 2-й response возвращает финальный `message`

Это критично, потому что `previous_response_id` — штатный способ продолжать такой цикл, а `function_call_output` должен быть связан с исходным вызовом через тот же `call_id`. ([OpenAI Developers][1])

---

## 6. Требования к кодеру

В PR должны быть:

* 8–10 unit-тестов на abort paths
* 1 integration-тест на полный tool round-trip
* 1 тест на повторную передачу `instructions`
* 1 тест на сохранение `phase`
* 1 тест на ring buffer логов