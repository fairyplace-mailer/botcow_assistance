# Существующее ТЗ по коду проекта BotCow

## 1. Статус документа
### 1.1. Название документа
Существующее ТЗ по коду проекта BotCow.

### 1.2. Версия
1.0.

### 1.3. Дата
Эти данные в коде отсутствуют.

### 1.4. Автор / владелец
По коду явно не зафиксировано. В репозитории указан проект `botcow-code-assistant`.

### 1.5. Правила изменения документа
В коде такие правила не отражены.

## 2. Цель проекта
### 2.1. Зачем создаётся бот
По `README.md` проект — продакшн-сервис для автоматизации CI/CD и GitHub-операций через чат-интерфейс.

### 2.2. Какую бизнес-задачу решает
По `README.md` и коду бот даёт чат-интерфейс для работы с кодом, GitHub, GitHub Actions, Vercel preview и внутренними инструментами.

### 2.3. Границы проекта
По реальному коду проект включает:
- Next.js 16 приложение с UI и API route;
- backend-слой для OpenAI Responses API;
- tool layer для GitHub, Vercel, preview и регистрации репозиториев;
- хранение conversation state в Postgres через Prisma `KvItem`;
- RAG по dev.wix.com docs;
- cron и admin endpoints;
- webhook для Vercel.

### 2.4. Что не входит в scope
В коде явно не зафиксировано. Частично видно только ограничения: preview only для Vercel deploy tools, production deploy запрещён в tool-слое.

## 3. Термины и определения
### 3.1. Бот
По коду это BotCow Code Assistant — чатовый ассистент с tool calling.

### 3.2. Пользователь
По UI и route это клиент, который отправляет `messages` в `/api/chat`.

### 3.3. Сессия
Сессия определяется через `x-botcow-session-id`. Если заголовка нет, route создаёт UUID. Во frontend session id хранится в `localStorage` по ключу `botcow:chat-session-id`.

### 3.4. Диалог / conversation
В коде есть OpenAI conversation state. Для cross-turn состояния используется `conversationId`, который хранится отдельно от frontend history.

### 3.5. Response
В backend используется объект `Response` из OpenAI Responses API.

### 3.6. Tool / function call
В коде это элементы `function_call` из `response.output`, которые исполняются через `handleToolCall(...)`, а результат возвращается как `function_call_output`.

### 3.7. Structured output
Отдельный жёсткий structured output контракт для модели в коде не выделен. Публичный normalized JSON есть только у backend route `/api/chat`.

### 3.8. RAG / knowledge base
В коде есть retrieval по dev.wix.com документации через `retrieveDevWixContext(...)` и форматирование контекста для system instructions.

### 3.9. SSE / streaming
Эти данные в коде отсутствуют. В просмотренных участках streaming не реализован.

### 3.10. Webhook
В коде есть webhook `/api/vercel/webhook` с проверкой подписи `VERCEL_WEBHOOK_SECRET`.

## 4. Общее описание системы
### 4.1. Общая схема решения
Клиентский UI отправляет историю сообщений в `/api/chat`. Route собирает instructions, при необходимости добавляет RAG context, выбирает модель через `chooseModel(...)`, поднимает conversation state из persistence и вызывает `runAssistant(...)`. Backend выполняет OpenAI Responses API цикл, tools и возвращает normalized JSON.

### 4.2. Основные компоненты
- frontend: `src/app/page.tsx`;
- chat route: `src/app/api/chat/route.ts`;
- assistant orchestration: `src/backend/assistant.ts`;
- OpenAI request helpers: `src/backend/responses.ts`, `src/backend/openai.ts`, `src/backend/openaiRuntime.ts`;
- model router: `src/backend/modelRouter.ts`;
- tools registry: `src/backend/tools/index.ts`;
- GitHub/Vercel/preview tools;
- Prisma/Postgres persistence: `src/backend/db.ts`, `src/backend/kv.ts`, `prisma/schema.prisma`;
- dev.wix RAG backend: `src/backend/devWixDocs/*`;
- Vercel webhook route.

### 4.3. Где находится LLM
LLM вызывается на backend через SDK `openai`.

### 4.4. Какие внешние сервисы используются
По коду и зависимостям используются:
- OpenAI;
- GitHub API;
- Vercel API;
- Postgres;
- dev.wix.com как источник RAG-данных.

### 4.5. High-level data flow
1. Пользователь отправляет сообщение.
2. Route валидирует `messages`.
3. Извлекается последний user message.
4. Опционально извлекается RAG context по dev.wix docs.
5. Строятся instructions из system messages.
6. Router выбирает `model` и `reasoning.effort`.
7. По `sessionId` читается сохранённый `conversationId`.
8. `runAssistant(...)` делает `responses.create(...)` и tool loop.
9. Новый state сохраняется.
10. Route логирует результат и возвращает normalized success/error JSON.

## 5. Роли и пользователи
### 5.1. Типы пользователей
По коду явно видны:
- обычный пользователь chat UI;
- администратор для admin/tools endpoints с bearer token;
- cron caller с `CRON_SECRET`;
- Vercel webhook sender с подписью.

### 5.2. Права и ограничения
- tools endpoints защищены `BOTCOW_ADMIN_TOKEN`;
- cron endpoints защищены `CRON_SECRET`;
- webhook защищён `VERCEL_WEBHOOK_SECRET`;
- production deploy через vercel tools запрещён.

### 5.3. Администратор / оператор / конечный пользователь
Разделение оператора отдельно в коде явно не выделено. Конечный пользователь работает через UI и `/api/chat`. Администратор подтверждается bearer token для защищённых route.

## 6. Сценарии использования
### 6.1. Основной happy path
Пользователь пишет в чат, backend выбирает модель, выполняет Responses API вызов, при необходимости tools, сохраняет conversation state и возвращает финальный ответ.

### 6.2. Альтернативные сценарии
По коду подтверждены:
- запрос с RAG context по dev.wix docs;
- чтение файла через UI;
- commit файла через UI;
- запуск GitHub workflow через UI;
- проверка статуса workflow через UI;
- admin/devwix ingest и seed routes;
- preview checks через preview tools.

### 6.3. Ошибочные сценарии
Подтверждены:
- `messages` не массив → 400;
- нет user query → 400;
- ошибка assistant run → normalized 500 error;
- bad JSON args tool → fail-fast;
- schema fail → fail-fast;
- unknown tool → fail-fast;
- timeout tool → fail-fast;
- repeated tool fingerprint → fail-fast;
- no progress → fail-fast;
- tool budget exceeded → fail-fast;
- loop limit → fail-fast.

### 6.4. Граничные случаи
Подтверждены:
- пустой session header → генерируется новый id;
- reasoning может быть запрошен router, но не отправлен, если runtime/model не поддерживает;
- conversation mode и previous_response mode не смешиваются в одном request builder;
- если RAG retrieval падает, route продолжает без RAG context.

### 6.5. Завершение диалога
Во frontend есть событие `botcow:new-chat`, которое очищает локальные сообщения, input и создаёт новый session id.

## 7. Функциональные требования
### 7.1. Приём пользовательского сообщения
`/api/chat` принимает JSON с `messages`.

### 7.2. Генерация ответа
Ответ генерируется через `runAssistant(...)` и OpenAI Responses API.

### 7.3. Поддержка многошагового диалога
Да. Реализовано через session id + persisted `conversationId`.

### 7.4. Память в рамках сессии / conversation
Есть. В persistence хранится `conversationId` и `latestResponseId` по `sessionId`.

### 7.5. Работа с файлами
Подтверждено:
- GitHub file read;
- GitHub commit file;
- GitHub delete file;
- frontend upload файла для commit.

### 7.6. Работа с изображениями
Эти данные в коде отсутствуют.

### 7.7. Вызов инструментов / функций
Да. Используется registry из GitHub, Vercel, deployment, preview и repo registration tools.

### 7.8. Возврат структурированного JSON
Публичный route `/api/chat` возвращает:
- success: `ok`, `sessionId`, `response{id, model, phase, outputText}`, `error: null`;
- error: `ok: false`, `sessionId`, `response: null`, `error{code,message}`.

### 7.9. История диалога
Во frontend история хранится локально через `chatStore`. Между turn'ами durable state на backend обеспечивается через `conversationId`. Полная server-side история сообщений в просмотренном коде не хранится как отдельная коллекция сообщений.

### 7.10. Экспорт / логирование / аудит
Есть логирование через `src/backend/log.ts`. Логи пишутся в `console.info/console.warn`, а также удерживаются в памяти в ring buffer `runBuffers`.

### 7.11. Режим background, если нужен
Эти данные в коде отсутствуют как отдельный OpenAI background mode.

### 7.12. Webhooks, если нужны асинхронные события
Есть webhook `/api/vercel/webhook`. Он проверяет подпись, сохраняет deployment, а при ready preview может комментировать PR.

## 8. Нефункциональные требования
### 8.1. Производительность
Явные SLA/latency требования в коде не зафиксированы. Подтверждён только timeout tools: `20000 ms`.

### 8.2. SLA / uptime
Эти данные в коде отсутствуют.

### 8.3. Масштабируемость
В коде явно не описана. Есть persistence в Postgres вместо in-memory для conversation state.

### 8.4. Безопасность
Подтверждены bearer secret для admin endpoints, secret для cron, подпись webhook, SSRF-защита preview HTTP, запрет production deploy через Vercel tools.

### 8.5. Конфиденциальность
Явная privacy policy в коде не отражена.

### 8.6. Наблюдаемость
Есть структурированное логирование и recent run buffer. Есть workflow/Vercel diagnostics tools.

### 8.7. Поддерживаемость
Есть TypeScript, Prisma schema, tests, docs. Дополнительные требования явно не зафиксированы.

### 8.8. Стоимость эксплуатации
Прямые требования в коде отсутствуют.

## 9. Архитектура
### 9.1. Архитектурный стиль
По коду это Next.js App Router приложение с API routes и отдельным backend-слоем модулей.

### 9.2. Диаграмма компонентов
В коде диаграмма отсутствует.

### 9.3. Диаграмма последовательностей
В коде диаграмма отсутствует.

### 9.4. Оркестратор
Основной оркестратор assistant flow — `src/backend/assistant.ts`.

### 9.5. Prompt layer
Prompt layer строится в `/api/chat`:
- большой system prompt;
- optional RAG system context;
- instructions как объединение system messages.

### 9.6. Tool layer
Tool layer — `src/backend/tools/index.ts` и конкретные tool modules.

### 9.7. Storage layer
Storage layer включает Prisma/Postgres и таблицу `KvItem` для KV state. Также есть другие Prisma модели: `GithubCache`, `CrawlJob`, `CronLock`, `DocPage`, `DocChunk`.

### 9.8. Integration layer
Integration layer включает OpenAI, GitHub, Vercel и dev.wix docs ingest/retrieval.

## 10. Модель взаимодействия с OpenAI Responses API
### 10.1. Какие модели разрешены
В model router объявлены:
- `gpt-5.4`;
- `gpt-5.4-mini`;
- `gpt-5.4-nano`.

### 10.2. Правила выбора модели
Правила реализованы эвристическим router `chooseModel(...)` по сигналам текста: debug, architecture, classification, codegen, CI/CD, Vercel, PM, long context и т.д.

### 10.3. Формат запроса в Responses API
Подтверждённые поля builder:
- `model`;
- `input`;
- `instructions`;
- `conversation` или `previous_response_id` или ничего;
- `reasoning` при наличии;
- `tools`;
- `parallel_tool_calls: false`.

### 10.4. Conversation state
Cross-turn state — через `conversation.id`.

### 10.5. Streaming
Эти данные в коде отсутствуют.

### 10.6. Structured outputs
Отдельный structured output контракт Responses API в коде не выделен.

### 10.7. Tools: built-in и custom functions
Подтверждены custom function tools. Built-in tools в просмотренном коде не подтверждены.

### 10.8. File inputs
Эти данные в OpenAI request builder отсутствуют.

### 10.9. Truncation / context limits
Явная truncation logic для OpenAI context в просмотренном коде отсутствует. Для RAG есть `maxChars: 6000` при формировании контекста в route.

### 10.10. Token counting / compaction / caching
Отдельный compaction/caching conversation context в коде не найден. Есть `responseUsage(...)` для логирования usage. Есть embedding/RAG слой отдельно.

### 10.11. Background mode
Эти данные в коде отсутствуют.

### 10.12. Webhooks по жизненному циклу response
Эти данные в коде отсутствуют.

## 11. Промптинг и управление поведением модели
### 11.1. System prompt
Есть большой system prompt прямо в `/api/chat/route.ts`.

### 11.2. Developer prompt / policy layer
Отдельного отдельного developer-layer файла не найдено. Фактически policy layer встроен в system prompt route.

### 11.3. User prompt handling
Route берёт последний `user` message как `userInput` и весь набор system messages склеивает в `instructions`.

### 11.4. Правила тона и стиля
В system prompt зафиксировано: отвечать кратко, структурированно, по сути, простыми словами.

### 11.5. Запрещённые темы / действия
В system prompt подтверждены запреты:
- не выдумывать данные;
- не обещать недоступное;
- не делать production deploy и merge main без запроса;
- не создавать ветки без команды пользователя;
- работать по ТЗ и tools.

### 11.6. Приоритет инструкций
В system prompt явно указано: `docs/spec.md` — приоритет.

### 11.7. Анти-инъекционные правила
Явный отдельный anti-injection слой в коде не выделен. Частично роль защиты выполняет system prompt с правилами не доверять неподтверждённым данным и работать только через tools.

### 11.8. Правила цитирования / источников
В route при RAG context добавляется правило: использовать этот контекст только когда релевантно и предпочитать цитировать Source URLs.

### 11.9. Правила работы при неопределённости
В system prompt прямо указано: если данных недостаточно, нужно честно сказать об этом.

## 12. Инструменты и function calling
### 12.1. Список инструментов
По registry подтверждены группы tools:
- GitHub tools;
- Vercel tools;
- deployment tools;
- preview tools;
- `repo_register`.

### 12.2. Когда какой инструмент разрешён
Подтверждено:
- preview/Vercel deploy tools только для preview;
- tools endpoints требуют admin auth;
- выбор конкретного инструмента в tool loop делает модель.
Другие жёсткие матрицы разрешений в коде не отражены.

### 12.3. JSON Schema аргументов
У каждого tool есть schema в соответствующем tool module. В assistant loop есть дополнительная runtime-проверка required fields, types и `additionalProperties: false`, если это указано.

### 12.4. Формат результата инструмента
Результат tool call заворачивается в `function_call_output` с тем же `call_id`, `output: JSON.stringify(result)`.

### 12.5. Таймауты
Подтверждён `TOOL_TIMEOUT_MS = 20000`.

### 12.6. Retry policy
Отдельной retry policy для tools в просмотренном коде не найдено.

### 12.7. Обработка ошибок инструмента
Есть fail-fast с internal codes:
- `invalid_tool_args_json`;
- `invalid_tool_args_schema`;
- `unknown_tool`;
- `tool_timeout`;
- `tool_execution_failed`;
- `repeated_tool_call`;
- `no_progress_abort`;
- `tool_budget_exceeded`;
- `no_actionable_output`;
- `tool_loop_limit`.
Наружу отдаются только public code/message.

### 12.8. Логирование вызовов
Логируются round start/end, tool success, fatal stop, openai request completed и chat request completed/failed.

### 12.9. Идемпотентность
Явная общая политика идемпотентности в коде не описана.

## 13. База знаний / RAG
### 13.1. Источники данных
Подтверждён источник dev.wix.com docs.

### 13.2. Форматы документов
По схеме `DocPage.text` и `DocChunk.content` хранятся текстовые представления. В ingest/retrieve backend есть markdown/blob utilities. Полный список форматов в просмотренном коде не зафиксирован.

### 13.3. Индексация
Есть таблицы `DocPage` и `DocChunk`. У `DocChunk` есть embedding поле pgvector.

### 13.4. Chunking
Есть модуль `tokenChunker.ts`, значит chunking реализован. Подробные правила в этом документе не расписываются, так как здесь фиксируются только подтверждённые факты высокого уровня.

### 13.5. Метаданные
Подтверждены поля страницы: `url`, `title`, `contentHash`, `httpStatus`, `fetchedAt`, `lastSeenAt`, `refreshIntervalHours`, `nextFetchAt`.

### 13.6. Retrieval strategy
В route вызывается `retrieveDevWixContext({ query, topK: 6, maxChars: 6000 })`.

### 13.7. Ранжирование
Эти данные подробно в просмотренном коде не зафиксированы.

### 13.8. Цитирование найденных фрагментов
Route добавляет инструкцию предпочитать Source URLs при ссылках на docs.

### 13.9. Политика обновления базы
Подтверждены admin и cron routes для `devwix-ingest`, `devwix-seed`, `devwix-sanity-cleanup`.

## 14. Контекст и память
### 14.1. Что хранится в conversation
Фактическое содержимое OpenAI conversation хранится на стороне OpenAI. В локальном persistence хранится только идентификатор `conversationId` и `latestResponseId`.

### 14.2. Что хранится вне conversation
Вне conversation хранятся:
- `sessionId`;
- `conversationId`;
- `latestResponseId`;
- локальная frontend history в browser storage;
- логи;
- RAG data в БД.

### 14.3. Краткосрочная память
Краткосрочная память frontend — массив `messages` в React state и локально сохранённые recent messages.

### 14.4. Долгосрочная память
Cross-turn backend память — `conversationId`/`latestResponseId` в `KvItem`.

### 14.5. Summarization / compaction
Эти данные в коде отсутствуют.

### 14.6. TTL и политика удаления
Для conversation state TTL не используется. KV в целом поддерживает `ttlSeconds`, но в `conversationState.ts` TTL не задаётся.

### 14.7. GDPR/privacy-ограничения
Эти данные в коде отсутствуют.

## 15. Работа с файлами
### 15.1. Разрешённые типы
Во frontend input type file явное ограничение accept не задано.

### 15.2. Ограничения по размеру
Эти данные в коде отсутствуют.

### 15.3. Upload flow
Frontend читает локальный файл как text и отправляет его содержимое на `/api/github/commit`.

### 15.4. Хранение
Загруженный пользователем файл в просмотренном коде отдельно не хранится; его содержимое отправляется в GitHub commit route.

### 15.5. Преобразование / extraction
Для пользовательского upload flow отдельное преобразование не подтверждено. Для RAG ingest есть текстовое преобразование docs.

### 15.6. Антивирус / валидация
Эти данные в коде отсутствуют.

### 15.7. Использование файлов в ответе модели
Прямой OpenAI file input flow в коде отсутствует.

## 16. API backend-сервиса
### 16.1. Список endpoints
По структуре репозитория подтверждены:
- `/api/chat`;
- `/api/health`;
- `/api/github/branch`;
- `/api/github/commit`;
- `/api/github/delete-branch`;
- `/api/github/file`;
- `/api/github/merge`;
- `/api/github/pr`;
- `/api/github/workflow/run`;
- `/api/github/workflow/status`;
- `/api/admin/devwix/ingest`;
- `/api/admin/devwix/seed`;
- `/api/cron`;
- `/api/cron/devwix-ingest`;
- `/api/cron/devwix-sanity-cleanup`;
- `/api/cron/devwix-seed`;
- `/api/vercel/webhook`;
- `/tools`;
- `/tools/call`.

### 16.2. Форматы запросов
Подробно подтверждён только `/api/chat`: JSON `{ messages: [...] }`. Для остальных endpoints формат есть в коде, но в этом документе детально не расписывается, так как полного backend API spec в коде нет.

### 16.3. Форматы ответов
Подтверждён публичный контракт `/api/chat`. Для остальных endpoints используются JSON responses, но общего унифицированного spec в коде нет.

### 16.4. Коды ошибок
Подтверждены 400, 401, 500 в просмотренных route. Полный каталог ошибок отсутствует.

### 16.5. Аутентификация
Есть bearer auth для admin/tools routes, bearer secret для cron, подпись для Vercel webhook.

### 16.6. Rate limiting
Эти данные в коде отсутствуют.

### 16.7. Версионирование API
Эти данные в коде отсутствуют.

## 17. Frontend / клиент
### 17.1. Экран(ы)
Подтверждён основной экран `src/app/page.tsx`.

### 17.2. Состояния UI
Подтверждены состояния:
- список сообщений;
- input;
- loading/error для чата;
- offline;
- commit file form;
- file viewer;
- workflow run/status.

### 17.3. Streaming-рендер ответа
Эти данные в коде отсутствуют.

### 17.4. Ошибки и системные сообщения
Во frontend есть отображение chatError, commitError, workflowError, offline notice и других статусов.

### 17.5. Работа с файлами
Есть file input и commit в GitHub, плюс просмотр файла из репозитория.

### 17.6. Ограничения ввода
Подтверждено ограничение textarea по высоте до примерно 6 строк. Другие ограничения явно не заданы.

### 17.7. Accessibility
Явные требования/accessibility checks в коде не отражены.

### 17.8. Localization
UI содержит русский и английский текст вперемешку. Отдельной i18n системы в коде не видно.

## 18. Состояния и конечный автомат
### 18.1. Idle
Подтверждено на уровне UI и assistant run до отправки запроса.

### 18.2. Input received
Подтверждено: route принимает `messages`, assistant получает `userInput`.

### 18.3. Sending
Подтверждено через `chatLoading` во frontend и `assistant_round_started` в backend.

### 18.4. Waiting tool
Это состояние явно не названо отдельным enum, но логически присутствует внутри tool loop.

### 18.5. Streaming
Эти данные в коде отсутствуют.

### 18.6. Completed
Подтверждено. В логах используется `finalStatus: 'completed'`.

### 18.7. Failed
Подтверждено. В логах используется `finalStatus: 'failed'`, route возвращает normalized error.

### 18.8. Cancelled
Для webhook deployment state `cancelled` есть. Для chat state отдельной отмены не найдено.

### 18.9. Retrying
Отдельного retry state для assistant loop не найдено.

## 19. Ошибки и отказоустойчивость
### 19.1. Ошибки OpenAI API
Специальный каталог ошибок OpenAI в просмотренном коде отсутствует. Ошибки проходят через `catch` route или приводят к failed run.

### 19.2. Ошибки tool layer
Да, подробно обработаны fail-fast guardrails.

### 19.3. Ошибки retrieval
Если retrieval падает, route просто не добавляет RAG context.

### 19.4. Ошибки файлов
Подтверждены UI ошибки чтения/commit файла. Полного backend catalog нет.

### 19.5. Ошибки формата JSON
Подтверждены проверки invalid chat payload и invalid tool args JSON.

### 19.6. Fallback behavior
Подтверждены:
- при падении RAG — продолжать без RAG;
- при пустом response/non-actionable output — normalized public error;
- reasoning может быть suppressed с логированием причины.

### 19.7. Circuit breaker / retries
Circuit breaker в коде не найден. Retry policy явно не реализована.

### 19.8. User-visible error messages
Публичный chat error: `Не удалось завершить действие автоматически. Попробуйте ещё раз.`

## 20. Безопасность
### 20.1. Хранение ключей
По коду используются env variables.

### 20.2. Secret management
Подтверждены env secrets:
- `OPENAI_API_KEY`;
- `GITHUB_PAT_BOTCOW`;
- `DATABASE_URL`;
- `BOTCOW_ADMIN_TOKEN`;
- `CRON_SECRET`;
- `VERCEL_WEBHOOK_SECRET`;
- и другие Vercel-related env.

### 20.3. RBAC
Полноценный RBAC в коде не найден. Есть только token-based разделение доступа.

### 20.4. Audit trail
Есть логирование run events, но отдельный неизменяемый audit trail в коде не описан.

### 20.5. Prompt injection defense
Явный отдельный механизм кроме system prompt и правила опираться только на tools не найден.

### 20.6. Input validation
Есть валидация chat payload, tool args JSON/schema, preview URL host allowlist, auth header formats.

### 20.7. Output filtering / moderation
Эти данные в коде отсутствуют.

### 20.8. PII handling
Эти данные в коде отсутствуют.

## 21. Логирование, мониторинг, аналитика
### 21.1. Что логируется
Подтверждены поля schema defaults:
- `traceId`, `userTurnId`, `conversationId`, `responseId`, `previousResponseId`, `round`, `totalToolCalls`, `model`, `modelReason`, `reasoningEffort`, `toolName`, `toolCallId`, `argsHash`, `argsParseOk`, `schemaValid`, `toolLatencyMs`, `toolResultClass`, `assistantPhase`, `stopReason`, `finalStatus`, `duration`, `usage`.
Также логируются chat payload-related поля и reasoning diagnostics.

### 21.2. Что нельзя логировать
Явные запреты в коде не отражены.

### 21.3. Метрики
Отдельная metrics система не найдена. Частично роль метрик выполняют structured logs и usage fields.

### 21.4. Трассировка запросов
Есть `traceId` и `userTurnId`.

### 21.5. Алерты
Эти данные в коде отсутствуют.

### 21.6. Продуктовая аналитика
Эти данные в коде отсутствуют.

### 21.7. Стоимость на запрос / сессию
Прямой расчёт стоимости в коде отсутствует.

## 22. Хранилища и данные
### 22.1. Схема БД
Используется Prisma schema с Postgres.

### 22.2. Таблицы / коллекции
Подтверждены модели:
- `KvItem`;
- `GithubCache`;
- `CrawlJob`;
- `CronLock`;
- `DocPage`;
- `DocChunk`.

### 22.3. История сообщений
Отдельной таблицы истории сообщений в схеме нет.

### 22.4. Хранилище файлов
Отдельного file storage для chat user uploads не найдено. Для repo contents используется GitHub. Для preview/runtime и deploy state есть отдельные backend механизмы, но это не универсальное file storage.

### 22.5. Индексы
Подтверждены индексы в Prisma schema для `GithubCache.expiresAt`, `CrawlJob`, `DocPage`, `DocChunk`.

### 22.6. Backup / restore
Эти данные в коде отсутствуют.

### 22.7. Retention policy
Общая retention policy в коде не отражена. Только `MAX_RECENT_RUN_EVENTS = 20` для in-memory run buffers и optional TTL support в KV layer.

## 23. Конфигурация
### 23.1. Переменные окружения
Подтверждены по коду и docs:
- `OPENAI_API_KEY`;
- `GITHUB_PAT_BOTCOW`;
- `DATABASE_URL`;
- `BOTCOW_ADMIN_TOKEN`;
- `CRON_SECRET`;
- `VERCEL_WEBHOOK_SECRET`;
- Vercel-related env (`VERCEL_TOKEN`, project/team id env);
- `BOTCOW_DEFAULT_REPO`.

### 23.2. Feature flags
Отдельные feature flags в коде не обнаружены.

### 23.3. Конфигурация моделей
Есть model router и runtime capability checks для reasoning.

### 23.4. Конфигурация инструментов
Есть tool schemas/handlers registry и `config/repos.yml` для repo resolution/Vercel mapping.

### 23.5. Конфигурация лимитов
Подтверждены:
- `MAX_TOOL_LOOPS = 12`;
- `MAX_TOTAL_TOOL_CALLS = 24`;
- `MAX_SAME_FINGERPRINT_IN_ROW = 2`;
- `MAX_NO_PROGRESS_ROUNDS = 2`;
- `TOOL_TIMEOUT_MS = 20000`;
- `MAX_RECENT_RUN_EVENTS = 20`.

## 24. DevOps и развёртывание
### 24.1. Environments: dev / stage / prod
По коду явно различаются production и non-production через `NODE_ENV`. Полная карта environments не описана.

### 24.2. CI/CD
Есть GitHub workflows: `ci.yml`, `test.yml`, `vercel-preview.yml`.

### 24.3. Infra requirements
Подтверждены требования к OpenAI, Postgres, GitHub token, Vercel integration. Полного infra spec в коде нет.

### 24.4. Миграции
Есть Prisma migrations и script `prisma:migrate`.

### 24.5. Rollback
Эти данные в коде отсутствуют.

### 24.6. Secret rotation
Эти данные в коде отсутствуют.

## 25. Тестирование
### 25.1. Unit tests
Есть Jest tests по backend/helpers.

### 25.2. Integration tests
Есть tests для chat route routing contract и assistant flow.

### 25.3. E2E tests
Эти данные в коде отсутствуют.

### 25.4. Contract tests
Есть contract-oriented tests для route и responses helpers.

### 25.5. Prompt regression tests
Отдельные prompt regression tests явно не выделены.

### 25.6. Tool-calling tests
Да, есть tests assistant stabilization и responses/tool-loop helpers.

### 25.7. Structured output validation tests
Отдельных tests для model structured output как отдельной фичи не найдено. Есть tests на normalized route response и `function_call_output`.

### 25.8. Load tests
Эти данные в коде отсутствуют.

### 25.9. Security tests
Отдельные security tests в просмотренном коде не найдены.

## 26. Критерии приёмки
### 26.1. Функциональные
Явный файл с acceptance criteria для существующей реализации отсутствует. Частично критерии подтверждаются тестами.

### 26.2. Нефункциональные
Эти данные в коде отсутствуют.

### 26.3. UX
Явные UX acceptance criteria в коде отсутствуют.

### 26.4. Безопасность
Явные acceptance criteria в коде отсутствуют.

### 26.5. Точность / качество ответов
Эти данные в коде отсутствуют.

### 26.6. Процент успешных tool calls
Эти данные в коде отсутствуют.

### 26.7. Допустимая стоимость
Эти данные в коде отсутствуют.

## 27. Ограничения и допущения
### 27.1. Что считается внешней зависимостью
Подтверждены внешние зависимости: OpenAI, GitHub, Vercel, Postgres, dev.wix docs.

### 27.2. Какие риски приняты
Явный список рисков в коде не отражён.

### 27.3. Какие вопросы сознательно отложены
По коду видно, что часть областей не проработана или не отражена: streaming, background mode, file inputs в OpenAI, formal SLA, load/security testing, full RBAC.

## 28. План реализации
### 28.1. Этапы
Эти данные в коде отсутствуют как отдельный план.

### 28.2. Очерёдность
Эти данные в коде отсутствуют.

### 28.3. Milestones
Эти данные в коде отсутствуют.

### 28.4. Deliverables
Эти данные в коде отсутствуют.

## 29. Приложения
### 29.1. Примеры запросов/ответов
Подтверждён пример публичного ответа `/api/chat` по тестам:
- success shape с `ok: true`, `sessionId`, `response{id, model, phase, outputText}`;
- error shape с `ok: false`, `sessionId`, `response: null`, `error{code,message}`.

### 29.2. JSON schemas
JSON schemas есть у tools в backend tool modules.

### 29.3. Примеры prompts
Подтверждён основной system prompt в `/api/chat/route.ts`. Отдельного каталога prompt examples в коде нет.

### 29.4. Sequence diagrams
Эти данные в коде отсутствуют.

### 29.5. Error catalog
Частичный internal error catalog есть в `assistant.ts`, полного отдельного каталога нет.

### 29.6. Glossary
Отдельный glossary файл отсутствует.

### 29.7. Чек-лист готовности ТЗ
Эти данные в коде отсутствуют.
