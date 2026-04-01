# ТЗ: новый `modelRouter.ts` под GPT-5.4 family

## 1) Цель

Переписать текущий роутер моделей так, чтобы он работал **только на GPT-5.4 family**:

- `gpt-5.4`
- `gpt-5.4-mini`
- `gpt-5.4-nano`

и использовал **полную шкалу `reasoning.effort`**:

- `none`
- `low`
- `medium`
- `high`
- `xhigh`

## 2) Текущее состояние

Сейчас роутер:
- использует `gpt-5.2` и `gpt-5.1-codex-max`;
- знает только `reasoning.effort = 'none' | 'high'`;
- выбирает codex-модель для short/small codegen;
- завязан на флаг `BOTCOW_CODEX_CHAT_COMPAT`.

Это надо убрать и заменить на новую схему.

## 3) Главное архитектурное решение

Новый роутер должен быть **максимально совместим по внешнему контракту**, но с новой внутренней логикой.

### Сохранить
- экспорт `OPENAI_EMBEDDING_MODEL`
- экспорт `chooseModel(messages)`
- формат результата:

```ts
{
  model: ...,
  reasoning?: { effort: ... },
  reason: string
}
```

### Изменить
- `ModelId`
- `ReasoningEffort`
- логику принятия решения
- удалить весь codex-specific fallback и `BOTCOW_CODEX_CHAT_COMPAT`

## 4) Совместимость

Нужно сделать **почти drop-in replacement**.

### Обязательное условие
Сигнатура функции должна остаться такой же:

```ts
export function chooseModel(
  messages: Array<{ role: string; content: unknown }>
): ModelRoutingDecision
```

### Новый набор типов

```ts
export type ModelId = 'gpt-5.4' | 'gpt-5.4-mini' | 'gpt-5.4-nano';
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';
```

### Важная оговорка
Если где-то в коде есть жёсткая проверка только на `'none' | 'high'`, её надо обновить.  
Если downstream-код просто прокидывает `model` и `reasoning.effort` в OpenAI API, то замена должна пройти почти безболезненно.

## 5) Жёсткие правила роутинга

### 5.1. Назначение моделей

#### `gpt-5.4`
Использовать для:
- сложного reasoning по коду;
- багов, stack traces, debug;
- code review;
- архитектуры;
- длинных/сложных многоходовых задач;
- больших контекстов;
- задач, где ошибка особенно дорога.

#### `gpt-5.4-mini`
Использовать для:
- типового codegen;
- short/medium refactor;
- обычных инженерных задач;
- PM/devops-запросов средней сложности;
- быстрых subagent-like шагов.

#### `gpt-5.4-nano`
Использовать только для:
- classification;
- extraction;
- ranking;
- простого intent detection;
- дешёвых вспомогательных шагов.

`nano` не использовать для архитектуры, code review, bug fixing, diff reasoning, large context, PR planning.

## 6) Полная шкала reasoning.effort

### `none`
- короткие простые запросы;
- простая классификация;
- извлечение фактов;
- PM/status without reasoning;
- very fast path.

### `low`
- простой codegen;
- короткие объяснения;
- маленький рефактор;
- boilerplate.

### `medium`
- стандартные инженерные задачи;
- типовой анализ кода;
- обычный debug без тяжёлого traceback;
- средний refactor;
- devops/support задачи средней сложности.

### `high`
- сложный debug;
- review diff;
- архитектурные вопросы;
- длинные технические обсуждения;
- когда есть риск скрытых ошибок.

### `xhigh`
- большой stack trace;
- критичный bug;
- запутанный multi-file reasoning;
- архитектурное решение с trade-offs;
- большой diff + высокий риск поломки;
- длинный контекст + код + ошибка + требования.

## 7) Порядок правил в `chooseModel`

Порядок обязателен. Более важные правила должны стоять выше менее важных.

### Rule 1. Нет текста пользователя
Если пользовательский текст отсутствует:
- `model = 'gpt-5.4-mini'`
- `reasoning.effort = 'none'`
- `reason = 'no-user-text'`

### Rule 2. Явная classification / extraction / ranking
Если запрос похож на:
- “классифицируй”
- “извлеки поля”
- “верни JSON”
- “сравни и ранжируй”
- “выдели сущности”
- “распарси”
- “определи intent”

то:
- `model = 'gpt-5.4-nano'`
- `reasoning.effort = 'none'` или `low`
- `reason = 'classification-or-extraction-or-ranking'`

### Rule 3. Тяжёлый debug / bug / review / big diff
Если есть:
- stack trace;
- error names;
- bug words;
- code review words;
- large diff;
- code fence + long context;
- несколько сильных признаков сразу;

то:
- `model = 'gpt-5.4'`
- `reasoning.effort = 'high'` или `xhigh`
- `reason = 'deep-code-debug-review'`

### Rule 4. Архитектура / design / system decisions
Если есть:
- architecture words;
- design pattern;
- boundaries;
- layers;
- trade-offs;
- “как лучше спроектировать”;
- большой абстрактный техразбор без конкретного бага;

то:
- `model = 'gpt-5.4'`
- `reasoning.effort = 'high'`
- `reason = 'architecture-or-design'`

### Rule 5. Обычный codegen / refactor / file edit
Если есть:
- code fence;
- ts/js keywords;
- refactor words;
- “напиши функцию”;
- “сделай компонент”;
- “перепиши файл”;
- “исправь этот кусок”;

то:
- short/medium context → `gpt-5.4-mini` + `low` или `medium`
- long/complex context → `gpt-5.4` + `high`

### Rule 6. PM / status / deploy / Vercel / CI
Если есть:
- issue/task/status/progress;
- deploy/redeploy/rollback/vercel;
- workflow/CI/logs/preview;

то:
- простой короткий запрос → `gpt-5.4-mini` + `none`/`low`
- если запрос аналитический, с логами или несколькими артефактами → `gpt-5.4-mini` + `medium`
- если есть реальные ошибки/диагностика с логами → Rule 3 и тогда `gpt-5.4`

### Rule 7. Короткий обычный запрос
Если короткий текст, мало сообщений, нет тяжёлых флагов:
- `gpt-5.4-mini`
- `reasoning.effort = 'low'`
- `reason = 'short-general-request'`

### Rule 8. Длинный сложный запрос без явного кода
Если контекст длинный и/или сообщений много:
- `gpt-5.4`
- `reasoning.effort = 'medium'` или `high`
- `reason = 'long-context-general'`

### Rule 9. Fallback
Во всех сомнительных случаях:
- предпочитать `gpt-5.4-mini`, если задача не выглядит рискованной;
- предпочитать `gpt-5.4`, если цена ошибки выше экономии.

## 8) Нужные признаки (`detectFlags`)

### Сохранить
- `hasCodeFence`
- `hasTsKeywords`
- `hasStackTrace`
- `hasArchWords`
- `hasRefactorWords`
- `hasBugWords`
- `hasReviewWords`
- `hasDiff`
- `hasPmWords`

### Добавить
- `hasExtractionWords`
- `hasClassificationWords`
- `hasRankingWords`
- `hasJsonSchemaWords`
- `hasTestWords`
- `hasSecurityWords`
- `hasMigrationWords`
- `hasLargeErrorPayload`
- `hasMultiFileIntent`
- `hasUiFrontendWords`
- `hasRepoOpsWords`
- `hasVercelWords`
- `hasCICDWords`

### Пример смыслов
- `hasExtractionWords`: extract, fields, parse, JSON, schema, entities, normalize
- `hasClassificationWords`: classify, category, label, intent, route
- `hasRankingWords`: rank, prioritize, sort by relevance
- `hasMultiFileIntent`: “по всему репо”, “в нескольких файлах”, “во всем проекте”
- `hasLargeErrorPayload`: длинный лог, traceback, repeated error tokens
- `hasSecurityWords`: vulnerability, auth, token leak, SSRF, permission denied

## 9) Нужно учитывать не только длину текста

Новый роутер должен считать **score-based signals**.

### Минимум такие входы
- `messageCount`
- `lastUserTextLength`
- `estimatedTotalTextLength`
- `codeBlockCount`
- `diffMarkersCount`
- `errorMarkerCount`
- `keywordFlags`
- `isLikelyClassificationTask`
- `isLikelyArchitectureTask`
- `isLikelyDebugTask`
- `isLikelyCodegenTask`

### Требование
Решение должно приниматься не одной регуляркой, а по сумме признаков.  
Но код должен оставаться простым и читаемым, без ML и без внешних зависимостей.

## 10) Strategy decision scoring

Нужно реализовать 3 внутренних score:

- `nanoScore`
- `miniScore`
- `fullScore`

и 5 score для effort:

- `noneScore`
- `lowScore`
- `mediumScore`
- `highScore`
- `xhighScore`

### Принцип
- сначала выбрать **семейство модели**;
- потом выбрать **уровень effort**;
- затем применить hard overrides.

### Hard overrides
- если classification/extraction/ranking → `nano`
- если stack trace / big diff / review / architecture → не `nano`
- если architecture или high-risk bug → только `gpt-5.4`
- если `gpt-5.4-nano` выбран, effort не выше `low`
- если `xhigh`, модель должна быть только `gpt-5.4`

## 11) Поведение по effort для каждой модели

### `gpt-5.4-nano`
Разрешить только:
- `none`
- `low`

### `gpt-5.4-mini`
Разрешить:
- `none`
- `low`
- `medium`
- `high`

Но `high` давать редко.

### `gpt-5.4`
Разрешить все:
- `none`
- `low`
- `medium`
- `high`
- `xhigh`

## 12) Что удалить

Обязательно удалить:
- `gpt-5.2`
- `gpt-5.1-codex-max`
- `MODEL_CODEX`
- `BOTCOW_CODEX_CHAT_COMPAT`
- все причины вида `codex-not-chat-compatible-*`

## 13) Что не трогать

Не менять:
- `OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small'`, если для этого нет отдельного задания.
- `config/repos.yml` логику.
- GitHub/Vercel маршруты.
- preview-only policy.

Важно: в новых изменениях **не вводить** зависимость от `BOTCOW_DEFAULT_REPO`. Истина для repo resolution — это `config/repos.yml`.

## 14) Логирование решения роутера

Нужно добавить диагностическое поле:

```ts
export interface ModelRoutingDecision {
  model: ModelId;
  reasoning?: { effort: ReasoningEffort };
  reason: string;
  debug?: {
    textLength: number;
    messageCount: number;
    flags: Record<string, boolean>;
    scores?: Record<string, number>;
  };
}
```

### Требование
`debug` включать только в dev/debug mode.  
В production можно скрывать или урезать.

## 15) Unit tests

Обязательно покрыть тестами минимум такие сценарии:

1. пустой input  
2. короткий обычный вопрос  
3. простой codegen  
4. short refactor  
5. long refactor  
6. stack trace  
7. large diff review  
8. архитектурный вопрос  
9. extraction в JSON  
10. ranking / prioritization  
11. PM/status request  
12. deploy / Vercel logs  
13. multi-message long context  
14. mixed case: short code + severe error  
15. mixed case: extraction request с куском кода

### Для каждого теста проверять
- выбранную модель;
- выбранный effort;
- `reason`.

## 16) Acceptance criteria

Задача считается выполненной, если:

1. `chooseModel()` компилируется и сохраняет старую сигнатуру.  
2. Роутер использует только `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`.  
3. Роутер использует полную шкалу effort.  
4. Нет codex-specific legacy кода.  
5. Есть unit tests.  
6. Есть краткий markdown-док `docs/model-routing.md` с таблицей правил.  
7. Нет новых зависимостей без явной необходимости.  
8. Не нарушена текущая архитектура Next.js API/backend.

## 17) Таблица выбора по умолчанию

| Сценарий | Модель | Effort |
|---|---|---|
| classification / extraction / ranking | `gpt-5.4-nano` | `none` / `low` |
| short general | `gpt-5.4-mini` | `low` |
| simple codegen | `gpt-5.4-mini` | `low` |
| normal code task | `gpt-5.4-mini` | `medium` |
| devops / CI / deploy normal | `gpt-5.4-mini` | `low` / `medium` |
| architecture | `gpt-5.4` | `high` |
| bug / traceback | `gpt-5.4` | `high` |
| severe debug / big diff / critical review | `gpt-5.4` | `xhigh` |
| long complex context | `gpt-5.4` | `medium` / `high` |

## 18) Указание BotCow по реализации

You SHALL:

- найти текущий `modelRouter.ts`;
- переписать его под GPT-5.4 family;
- сохранить экспорт и внешнюю сигнатуру;
- удалить legacy codex-path;
- добавить score-based routing;
- добавить tests;
- добавить `docs/model-routing.md`;
- не трогать repo resolution и не опираться на `BOTCOW_DEFAULT_REPO`;
- сделать изменения в отдельной ветке, затем PR, затем прогон preview/CI по обычному pipeline.

## 19) Итог

Это **новый роутер**, а не мелкий patch.  
Снаружи можно сохранить почти тот же контракт, но внутренняя логика должна быть перепроектирована полностью.
