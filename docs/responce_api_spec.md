# responce_api_spec.md

# ТЗ для BotCow: полная миграция с Chat Completions на Responses API

## 1. Цель

Полностью перевести backend BotCow с `chat.completions` на **Responses API**.

Под “полной миграцией” в этой задаче понимается:

1. заменить OpenAI endpoint:
   - с `client.chat.completions.create(...)`
   - на `client.responses.create(...)`

2. перейти со старого response shape:
   - `completion.choices[0].message`
   - на новый response shape Responses API

3. переписать tool-calling loop под Responses API:
   - распознавание `function_call`
   - исполнение tool calls
   - возврат `function_call_output`
   - повторные запросы до финального ответа

4. внедрить **stateful conversation model**:
   - целевая модель состояния: **Conversations API**
   - не ручное склеивание всей истории как основной механизм

5. сохранить рабочее поведение BotCow как инженерного исполнителя:
   - выбор модели через новый router
   - поддержка `reasoning.effort`
   - tool-first workflow
   - корректная работа route/backend/frontend contract

---

## 2. Источники истины

BotCow обязан исходить из:

1. реального кода репозитория;
2. текущих backend entry points;
3. реального OpenAI integration layer;
4. реального фронтового контракта;
5. `config/repos.yml` как единственного источника истины для repo-resolution;
6. утверждённого нового model router на GPT-5.4 family.

Если реальные файлы, функции или слои называются иначе — ориентироваться на реальный код.

---

## 3. Что уже известно о текущем состоянии

По текущему коду видно следующее:

- `route.ts` формирует `systemMessage`, добавляет RAG context, собирает `fullMessages`
- затем вызывает `chooseModel(fullMessages)`
- затем вызывает assistant layer
- затем возвращает в ответ “сырое completion”, чтобы фронт не ломался

Это означает:
- текущий контракт всё ещё ориентирован на старый Chat Completions response shape
- route/backend/frontend path надо мигрировать согласованно, а не только заменить SDK-вызов

---

## 4. Целевая архитектура

### 4.1. OpenAI layer
Новый целевой execution layer должен использовать:
- `client.responses.create(...)`

### 4.2. Response model
Новый backend должен работать не с:
- `completion.choices[0].message`

а с:
- `response`
- `response.output`
- `response.output_text`
- typed items (`message`, `function_call`, `function_call_output`, и т.д.)

### 4.3. Stateful model
Целевая модель statefulness:
- **Conversations API** как основной durable conversation container

Допустимо на переходном этапе использовать `previous_response_id`, но:
- это не должно быть конечной архитектурой для основного chat-flow,
- если в проекте уже есть chat/session сущность, нужно привязать её к `conversation_id`.

### 4.4. Tool execution
Tool-calling должен быть построен по contract Responses API:
- response может содержать 0, 1 или несколько `function_call`
- tool outputs должны возвращаться в model через `function_call_output`
- цикл должен продолжаться до финального assistant answer или until stop condition

---

## 5. Главное архитектурное решение по statefulness

### Обязательное решение
Для финальной архитектуры использовать **Conversations API** как primary state layer.

### Причина
BotCow — это не одноразовый single-turn helper, а чатовый инженерный ассистент.  
Для такого сценария durable conversation object подходит лучше, чем ручное хранение всего массива messages как единственного источника состояния.

### Допустимый transitional режим
Если полный переход на Conversations API сразу слишком тяжёл:
- можно временно сделать migration step через `previous_response_id`,
- но финальный контракт задачи — Conversations API.

### Запрещено
Не оставлять финальную реализацию на ручном бесконечном накоплении `messages[]` как основном механизме памяти.

---

## 6. Что именно нужно изменить

### 6.1. Переписать OpenAI request layer

Нужно найти реальное место, где сейчас вызывается:
- `client.chat.completions.create(...)`

и заменить его на новый execution path через:
- `client.responses.create(...)`

#### Требование
Новый request должен поддерживать:
- `model`
- `reasoning`
- `input`
- `instructions` или эквивалентный слой для системных указаний
- `tools`
- statefulness через `conversation`
- при необходимости `store`

#### Важно
Нельзя ограничиться поверхностной заменой endpoint string.  
Нужно переписать реальный контракт request/response.

### 6.2. Переписать входной формат

Сейчас backend работает через:
- массив `messages`
- system message
- optional RAG system message
- user/assistant messages

Нужно решить и реализовать, как это ляжет в Responses API.

#### Целевой принцип
- system-level behavior передавать через `instructions` или эквивалентный developer/system layer
- пользовательские и исторические элементы передавать как `input`
- RAG context передавать как отдельный контекстный item только когда он релевантен

#### Требование
Нельзя просто механически перенести старый массив `messages` без проверки совместимости нового execution flow.

### 6.3. Переписать output parsing

Нужно найти все места, где код ожидает:
- `completion`
- `choices`
- `message`
- `message.content`

и обновить их под Responses API.

#### Требование
Новый backend должен уметь:
- извлекать финальный текст ответа из `response.output_text`, если это допустимо;
- при необходимости разбирать `response.output` как массив typed items;
- отличать финальный `message` от промежуточных tool-calling items.

#### Обязательно
Нельзя оставлять старый код, который ожидает `completion.choices[0].message`.

### 6.4. Полностью переписать tool-calling loop

Это один из ключевых пунктов задачи.

#### Сейчас
Если текущая логика assistant layer построена под Chat Completions function-calling format, её нужно переписать.

#### Целевое поведение
Новый execution loop должен:

1. отправлять запрос в Responses API с tools
2. получать response
3. проверять `response.output`
4. находить все items типа `function_call`
5. выполнять соответствующие local/internal tools
6. формировать `function_call_output` items
7. отправлять следующий `responses.create(...)`
8. продолжать цикл, пока модель:
   - не вернёт финальный ответ
   - или не будет достигнут stop condition / guardrail

#### Обязательно
Предполагать, что function calls может быть:
- ноль
- один
- несколько

#### Нужно поддержать
- корректный вызов нескольких tools
- сохранение порядка или параллельность там, где это безопасно
- строгую обработку ошибок tool execution

### 6.5. Ввести stop conditions и safety guards

Новый tool loop должен иметь ограничения, чтобы BotCow не зацикливался.

#### Обязательные guardrails
- max loop iterations
- max consecutive tool rounds
- stop on repeated identical failing tool calls
- stop on malformed tool arguments
- stop on unknown tool name
- stop on missing required tool result
- stop on empty/no-progress response chain

#### При остановке
BotCow должен:
- вернуть короткую честную ошибку;
- зафиксировать промежуточный статус;
- по возможности предложить следующий шаг.

### 6.6. Внедрить Conversations API

Нужно реализовать durable conversation state.

#### Требование
Для каждого чата/сессии BotCow должен уметь:
- создать conversation object
- сохранить `conversation_id`
- использовать его в последующих `responses.create(...)`
- восстанавливать conversation state при следующих user turns

#### Нужно решить по реальному коду
Где хранить `conversation_id`:
- в existing DB
- в chat/session table
- в log/blob only storage нельзя делать как основной durable store, если это ломает быстрый доступ и нормальную работу чата

#### Обязательно
Storage strategy должна быть:
- явной
- простой
- устойчивой

#### Запрещено
Не хранить `conversation_id` только в памяти процесса как основной способ statefulness.

### 6.7. Синхронизировать внутреннюю chat/session модель и conversation model

Если у проекта уже есть:
- chat session
- thread id
- internal message history
- frontend chat history

нужно явно сопоставить это с новым `conversation_id`.

#### Цель
У каждой реальной сессии BotCow должна быть понятная связь:
- internal session/chat id
- OpenAI conversation id
- optional latest response id
- current repo/mode metadata where useful

### 6.8. Определить правила для instructions

У проекта уже есть system prompt + optional RAG system context.

Нужно переписать это для Responses API так, чтобы:

- system instructions задавались явно и стабильно;
- они не терялись между turns;
- RAG context не раздувал conversation без необходимости;
- актуальные project constraints сохранялись.

#### Требование
Не разбрасывать system behavior по случайным input items.

#### Предпочтительно
Сделать единый builder:
- base instructions
- optional repo-specific/spec-specific context
- optional RAG context
- user input

### 6.9. Обновить route/backend/frontend contract

Сейчас route, судя по коду, возвращает старый raw completion, чтобы фронт не ломался.

Для полной миграции это нужно изменить.

#### Допустимы 2 пути

##### Вариант A — чистая миграция
- обновить frontend под новый response contract
- route возвращает уже не старый completion shape, а новый нормализованный ответ

##### Вариант B — промежуточный adapter
- backend переходит на Responses API
- route или assistant layer временно строит normalized adapter-response для старого фронта
- после этого фронт мигрируется отдельно

#### Для этой задачи целевой результат
Полная миграция предпочтительно должна завершиться **нормализованным новым контрактом**, а не вечным adapter hack.

Если для безопасного rollout нужен adapter — он допустим, но:
- должен быть явно временным;
- должен быть помечен как transitional layer;
- должен быть задокументирован.

### 6.10. Сохранить поддержку нового model router

Новый router уже должен выбирать:
- `gpt-5.4`
- `gpt-5.4-mini`
- `gpt-5.4-nano`
- `reasoning.effort`

#### Требование
В новом Responses path BotCow обязан:
- использовать `routing.model`
- использовать `routing.reasoning`
- не терять `reasoning.effort`

#### Обязательно
Если router выбрал, например:

```ts
{
  model: 'gpt-5.4',
  reasoning: { effort: 'xhigh' }
}
```

то именно это должно уходить в Responses API request.

---

## 7. Правила для tool contract

Нужно явно определить и использовать единый tool contract для Responses API.

### 7.1. Tool declaration
Все tools должны быть переданы в модель в совместимом с Responses формате.

### 7.2. Tool execution
Каждый вызов tool должен:
- валидироваться;
- исполняться сервером;
- возвращать нормализованный result;
- быть сопоставим с `call_id`.

### 7.3. Tool output return
Результат tool execution должен возвращаться в следующий model request как `function_call_output`.

### 7.4. Ошибки
Если tool failed:
- не скрывать ошибку;
- возвращать модели нормализованный failure output, если это полезно;
- или завершать loop с честной ошибкой, если продолжать нельзя.

---

## 8. Требования к данным и хранению

### 8.1. Что нужно хранить минимум
Для каждой сессии/диалога нужно хранить минимум:

- internal chat/session id
- OpenAI `conversation_id`
- latest response id (если используется как служебная оптимизация)
- timestamps
- repo/mode metadata, если это уже входит в вашу модель чата

### 8.2. Что не хранить как единственный источник истины
Не использовать только:
- in-memory variables
- raw frontend history
- blob-лог как единственный store conversation state

---

## 9. Logging и observability

Нужно обновить логирование под новый execution model.

### Логировать минимум:
- `model`
- `reasoningEffort`
- route mode / execution mode
- `conversation_id`
- response id
- tool calls
- tool call results status
- final status
- duration

### При ошибке
Логировать:
- stage of failure
- request/response layer
- tool name if applicable
- whether failure happened before or after tool execution
- whether conversation state was already created

### Debug rule
Расширенный debug только если:

```ts
process.env.NODE_ENV !== 'production'
```

Новый debug env-флаг не вводить без отдельного задания.

---

## 10. Документация

Нужно добавить/обновить минимум такие документы:

### 10.1. `docs/responses-api-migration.md`
Кратко:
- что изменилось
- почему больше не используется Chat Completions
- новый request/response contract
- statefulness strategy

### 10.2. `docs/tool-calling-loop.md`
Кратко:
- как работает новый loop
- как обрабатываются function_call и function_call_output
- какие guardrails есть

### 10.3. `docs/conversation-state.md`
Кратко:
- где хранится `conversation_id`
- как session/chat id связан с conversation
- как происходит восстановление состояния

### 10.4. `docs/frontend-contract.md`
Кратко:
- какой shape ответа теперь получает frontend
- есть ли transitional adapter
- как из backend ответа извлекается final assistant message

---

## 11. Тесты

Нужно не ограничиваться unit tests на один слой.  
Нужны integration tests по ключевым переходам.

### 11.1. Минимальный набор тестов

#### A. Request building
1. Responses request получает:
   - model
   - reasoning
   - input/instructions
   - tools
   - conversation

#### B. Response parsing
2. Простой текстовый ответ корректно извлекается из Responses result
3. Финальный assistant message корректно выделяется из `response.output`

#### C. Tool loop
4. Один function call → tool execution → final answer
5. Несколько function calls → все исполняются корректно
6. Unknown tool → loop завершается корректно
7. Tool failure → ошибка обрабатывается корректно
8. Repeated no-progress loop → guardrail останавливает цикл

#### D. Stateful model
9. Новый chat создаёт `conversation_id`
10. Последующий user turn использует существующий `conversation_id`
11. `conversation_id` корректно сохраняется и читается из persistence layer

#### E. Logging
12. Логи содержат:
   - model
   - reasoningEffort
   - conversation_id
   - response id
   - tool call info

#### F. Backward / frontend contract
13. Route возвращает новый ожидаемый shape
14. Если есть transitional adapter, он покрыт тестом и не ломает фронт

---

## 12. Acceptance criteria

Задача считается выполненной, если:

1. В проекте больше нет основного execution path через `chat.completions.create(...)`
2. Основной OpenAI path использует `responses.create(...)`
3. Backend корректно работает с new response shape
4. Tool loop переписан под Responses API
5. `function_call` и `function_call_output` обрабатываются корректно
6. Внедрён stateful conversation model на базе Conversations API
7. Для каждой сессии сохраняется `conversation_id`
8. Новый router продолжает влиять и на `model`, и на `reasoning.effort`
9. Route/backend/frontend contract приведён к рабочему состоянию
10. Логи и тесты обновлены
11. Документация обновлена
12. Нет скрытого возврата к старому chat-completions контракту

---

## 13. Порядок внедрения

Делать строго поэтапно.

### Этап 1. Аудит
Найти реальный код:
- route layer
- assistant layer
- openai client layer
- tool loop
- frontend response parsing
- storage/session/chat persistence

### Этап 2. Новый OpenAI request layer
- внедрить `responses.create(...)`
- поддержать `model`, `reasoning`, `input/instructions`, `tools`

### Этап 3. Новый response parser
- переписать parsing
- научить backend извлекать финальный ответ из Responses

### Этап 4. Tool loop
- переписать function calling loop
- добавить guardrails
- покрыть тестами

### Этап 5. Stateful conversation
- внедрить Conversations API
- сохранить `conversation_id`
- связать с chat/session

### Этап 6. Route/frontend contract
- обновить route response
- обновить frontend или временный adapter

### Этап 7. Logging/docs/tests
- обновить logging
- добавить docs
- пройти integration tests

---

## 14. Что не нужно делать в этой задаче

Сейчас не нужно:
- снова переписывать model router
- менять repo-resolution
- менять `config/repos.yml`
- делать production deploy automation
- внедрять Codex app
- делать unrelated large refactor UI, если он не нужен для migration
- оставлять вечный transitional adapter без плана удаления

---

## 15. Практическая формула задачи

Нужно перевести BotCow с модели:
- stateless-ish chat completions
- message/choices contract
- legacy function-calling loop

на модель:
- Responses API
- typed response items
- Responses-native tool loop
- durable conversation state через Conversations API
- новый backend/frontend contract

Так, чтобы BotCow остался рабочим инженерным ассистентом и стал ближе к целевой agentic architecture.

---

## 16. Итог

Это не “заменить один SDK-вызов”.

Это полная миграция 4 связанных слоёв:

1. OpenAI endpoint layer
2. response parsing layer
3. tool-calling orchestration layer
4. conversation state layer

Задача считается завершённой только когда все 4 слоя работают согласованно.
