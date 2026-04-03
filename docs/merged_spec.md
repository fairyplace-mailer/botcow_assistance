Это — **канонический merged spec**, который закрывает противоречия и лакуны между тремя файлами. Это и надо считать базовым ТЗ для бот-кодера. Основа: полная миграция на Responses API; router contract и tool-loop guardrails — это вложенные части этой миграции, а не отдельные независимые задачи.   

## 1. Приоритет документов

1. **Главный документ:** `docs/responce_api_spec.md`. Он задаёт scope всей задачи: новый OpenAI path, новый response shape, tool loop, durable state, route/backend/frontend contract, logging, docs, tests. 
2. **Подзадача 1:** `docs/router_contract_spec.md` — обязательный propagation `model + reasoning.effort` от `chooseModel(...)` до реального OpenAI request.  
3. **Подзадача 2:** `docs/tool_loop_mistake.md` — fail-fast tool loop, guardrails, `function_call_output`, phase retention, public/internal error split.  

## 2. Цель

Полностью перевести backend с legacy `chat.completions` и старого function-calling loop на **Responses API** с:

* typed response items,
* корректным tool execution loop,
* сохранением `model + reasoning.effort`,
* durable state через `conversation`,
* рабочим route/backend/frontend contract.  

## 3. Главный state contract

Нужно жёстко разделить два уровня состояния:

* **Внутри одного user turn / внутри tool loop**: `previous_response_id` допустим только как вспомогательный loop/compat path, если это реально нужно для продолжения цепочки шагов Responses API внутри одного turn. При каждом новом `responses.create(...)` заново передавать `instructions`.  
* **Между user turns / для долговременного состояния чата**: использовать **conversation-based durable path** и хранить `conversationId` в persistence, привязанным к internal chat/session id. Нельзя держать это только в памяти процесса.  

То есть:
`conversation` = **cross-turn durable state**
`previous_response_id` = **intra-turn helper path only**.
Это обязательное правило.

`conversation` и `previous_response_id` нельзя смешивать в одном `responses.create(...)` request.

## 4. Единый контракт типов

Старый контракт вида `runAssistant(fullMessages, routing.model)` запрещён. Нужно передавать весь routing decision или хотя бы нормализованный объект routing options. 

Канонический тип:

```ts
type AssistantRunOptions = {
  model: ModelId;
  reasoning?: { effort: ReasoningEffort };
  reason?: string;
};

type ConversationStateRef = {
  conversationId?: string;
  previousResponseId?: string;
};

type RunAssistantTurnParams = {
  instructions: string;
  userInput: string;
  tools: ToolRegistry;
  routing: AssistantRunOptions;
  state: ConversationStateRef;
};
```

Правило: поля `model` и `reasoning` не могут теряться ни на одном участке пути:
`chooseModel` → `route.ts` → `runAssistant` → OpenAI request builder → `responses.create(...)`.  

## 5. OpenAI execution contract

Основной execution path должен идти через `client.responses.create(...)`. Основного production path через `chat.completions.create(...)` после миграции оставаться не должно. 

Каждый request обязан поддерживать:

* `model`,
* `reasoning`,
* `instructions`,
* `input`,
* `tools`,
* `conversation` для durable state,
* `previous_response_id` только для допустимого intra-turn helper path, если это нужно в данном turn.  

Финальная стратегия между turn'ами — только `conversation-based durable path`.

## 6. Tool loop contract

Tool loop строится только по правилам Responses API:

1. вызвать `responses.create(...)`;
2. разобрать `response.output`;
3. найти все `function_call`;
4. валидировать tool name и arguments;
5. выполнить tool через timeout wrapper;
6. вернуть результат как `function_call_output` с тем же `call_id`;
7. продолжать цикл до финального assistant message или stop condition. 

Обязательные guardrails:

* `MAX_TOOL_LOOPS`,
* `MAX_TOTAL_TOOL_CALLS`,
* stop on bad JSON args,
* stop on schema validation fail,
* stop on unknown tool,
* stop on timeout,
* stop on repeated fingerprint,
* stop on no-progress,
* stop on empty/non-actionable response.  

`parallel_tool_calls: false` — пока использовать как дефолт для детерминированного цикла. 

## 7. Assistant history / phase rules

Если state ведётся вручную в каких-то участках, нельзя выбрасывать:

* assistant items,
* function_call,
* function_call_output,
* reasoning items. 

Если assistant messages сохраняются/прокидываются вручную, нужно сохранять и пересылать:

```ts
phase: "commentary" | "final_answer"
```

Это обязательная часть follow-up path. 

## 8. Frontend / route contract

Финальная цель — новый нормализованный backend response contract, а не старый raw completion shape.

Канонический final normalized route response contract:

### Success

```json
{
  "ok": true,
  "sessionId": "string",
  "response": {
    "id": "string",
    "model": "string",
    "phase": "final_answer",
    "outputText": "string"
  },
  "error": null
}
```

### Error

```json
{
  "ok": false,
  "sessionId": "string",
  "response": null,
  "error": {
    "code": "assistant_run_failed",
    "message": "Не удалось завершить действие автоматически. Попробуйте ещё раз."
  }
}
```

Правила:

* `conversationId` не является частью public contract, если фронту он специально не нужен;
* `ok` обязателен для явного различения success/error path;
* `phase` входит в normalized public response.  

## 9. Logging contract

`log.ts` не может быть no-op. Единый минимальный log schema должен покрывать и loop, и routing, и state:

* `traceId`
* `userTurnId`
* `conversationId`
* `responseId`
* `previousResponseId`
* `round`
* `totalToolCalls`
* `model`
* `modelReason`
* `reasoningEffort`
* `toolName`
* `toolCallId`
* `argsHash`
* `argsParseOk`
* `schemaValid`
* `toolLatencyMs`
* `toolResultClass`
* `assistantPhase`
* `stopReason`
* `finalStatus`
* `duration`
* `usage`   

Expanded debug — только если `process.env.NODE_ENV !== 'production'`.  

## 10. Error contract

Наружу нельзя отдавать внутренние loop/error enums или stack trace. Публичный ответ должен быть нормализованным, например:

```json
{
  "code": "assistant_run_failed",
  "message": "Не удалось завершить действие автоматически. Попробуйте ещё раз."
}
```

В логах при этом сохраняется точный `internalCode`. 

## 11. Acceptance criteria

Задача считается выполненной только если одновременно выполнены все условия:

1. Основной path больше не использует `chat.completions.create(...)`. 
2. `responses.create(...)` реально получает `model + reasoning + instructions + input + tools + conversation`. 
3. `reasoning.effort` не теряется от router до request payload. 
4. Tool loop корректно обрабатывает `function_call` и `function_call_output` по `call_id`. 
5. Fail-fast guardrails работают на bad JSON / schema fail / unknown tool / timeout / repeated call / no progress. 
6. Для каждой сессии есть связка `internal session/chat id ↔ conversationId ↔ latestResponseId(optional)`.  
7. `assistant.phase` сохраняется там, где это нужно. 
8. Route/frontend contract уже новый normalized shape. 
9. Логи содержат routing, state и tool-loop поля. 
10. Docs обновлены. 

## 12. Порядок внедрения

Правильный порядок такой:

1. аудит реального кода;
2. новый contract `route.ts` → `runAssistant`;
3. новый contract `runAssistant` → OpenAI layer;
4. перепись response parser;
5. fail-fast tool loop;
6. durable conversation state;
7. route/frontend contract;
8. logging/docs/tests.
