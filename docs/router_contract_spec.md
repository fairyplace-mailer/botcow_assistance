# router_contract_spec.md

# ТЗ для BotCow: довести новый model router до полного рабочего состояния в backend

## 1. Цель

Новый model router уже умеет возвращать не только `model`, но и `reasoning.effort`.

Нужно довести backend до состояния, в котором выбор роутера **реально влияет на OpenAI request**, а не теряется между слоями.

Сейчас проблема в том, что `route.ts` вызывает `runAssistant(fullMessages, routing.model)`, то есть из результата `chooseModel(...)` дальше передаётся только `model`, а `reasoning` теряется.

Цель этой задачи:
- сохранить полный routing decision;
- прокинуть его через backend;
- использовать его в реальном OpenAI request;
- логировать факт использования.

---

## 2. Что считается источником истины

При выполнении этой задачи BotCow обязан исходить из **реального кода репозитория**, а не из предположений.

Нужно:
- найти фактическую реализацию `runAssistant`;
- найти фактическую реализацию OpenAI client/request;
- найти все места, где используется результат `chooseModel(...)`;
- найти существующие тесты на chat/backend/openai/router path.

Если реальные имена файлов или функций отличаются от ожидаемых, ориентироваться на реальный код.

---

## 3. Что уже известно по текущему состоянию

Из текущего кода видно:

### 3.1. В `route.ts`
Есть вызов:

```ts
const routing = chooseModel(fullMessages);
const result = await runAssistant(fullMessages, routing.model);
```

Это означает:
- `chooseModel(...)` возвращает объект routing decision;
- в `runAssistant(...)` передаётся только `routing.model`;
- `routing.reasoning` и прочие поля не используются.

### 3.2. Следствие
Даже если новый router корректно выбирает:
- `gpt-5.4`
- `gpt-5.4-mini`
- `gpt-5.4-nano`
- `reasoning.effort = none | low | medium | high | xhigh`

backend сейчас может фактически использовать только `model`, а `effort` теряется до OpenAI layer.

---

## 4. Обязательный результат

Нужно добиться, чтобы:

1. `chooseModel(...)` возвращал полный routing decision.
2. `route.ts` передавал дальше не только `model`, но и `reasoning`.
3. `runAssistant(...)` принимал routing options.
4. OpenAI execution layer реально использовал:
   - `model`
   - `reasoning.effort`
5. Логи фиксировали:
   - модель
   - reason
   - reasoning effort
6. Тесты подтверждали, что effort не теряется по пути.

---

## 5. Обязательные изменения

## 5.1. Изменить контракт между `route.ts` и `runAssistant`

### Требование
Нельзя больше вызывать `runAssistant(...)` только с `routing.model`.

Нужно передавать:
- либо весь routing decision;
- либо объект `{ model, reasoning }`.

### Предпочтительный вариант
Использовать единый объект routing decision на всём пути.

Пример целевого смысла:

```ts
const routing = chooseModel(fullMessages);
const result = await runAssistant(fullMessages, routing);
```

### Допустимый вариант
Если архитектурно удобнее, можно передавать урезанный объект:

```ts
const result = await runAssistant(fullMessages, {
  model: routing.model,
  reasoning: routing.reasoning,
});
```

### Запрещено
Не оставлять старый контракт вида:

```ts
runAssistant(fullMessages, routing.model)
```

---

## 5.2. Изменить сигнатуру `runAssistant`

### Требование
`runAssistant` должен уметь принимать routing options.

Нужно определить и использовать понятный тип. Например:

```ts
type AssistantRunOptions = {
  model: ModelId;
  reasoning?: { effort: ReasoningEffort };
};
```

или использовать сам `ModelRoutingDecision`, если это удобнее и не тащит лишние поля в неподходящие слои.

### Обязательно
Внутри `runAssistant` нельзя терять `reasoning`.

---

## 5.3. Прокинуть routing options в OpenAI execution layer

### Требование
Нужно найти реальное место, где формируется OpenAI request, и передавать туда:

- `model`
- `reasoning`

Если текущий OpenAI layer уже умеет принимать `reasoning`, нужно просто довести контракт до него.

Если не умеет — нужно расширить его интерфейс.

### Целевое поведение
Если router выбрал, например:

```ts
{
  model: 'gpt-5.4',
  reasoning: { effort: 'xhigh' },
  reason: 'deep-code-debug-review'
}
```

то реальный OpenAI request должен использовать:
- `model = 'gpt-5.4'`
- `reasoning.effort = 'xhigh'`

### Важно
Не ограничиваться только передачей параметров между функциями.  
Нужно убедиться, что эти параметры реально входят в payload запроса к OpenAI.

---

## 5.4. Предпочтительный execution path

### Целевой путь
Предпочтительный путь — **Responses API**, потому что задача уже строится вокруг:
- GPT-5.4 family
- reasoning.effort
- tool-calling / multi-step execution

Если проект уже на transitional path:
- допустимо сделать промежуточную совместимость;
- но логика должна быть выстроена так, чтобы reasoning не терялся.

### Требование
BotCow должен ориентироваться на реальный код в repo:
- если переход на Responses API уже начат — продолжить правильно;
- если пока используется иной слой — реализовать контракт так, чтобы routing options дошли до реального OpenAI request.

---

## 5.5. Добавить логирование reasoning effort

Сейчас в логах уже есть:
- `model`
- `modelReason`

Нужно добавить:
- `reasoningEffort`

### Требование
Логировать минимум:
- `routing.model`
- `routing.reason`
- `routing.reasoning?.effort ?? null`

### Желательно
Если в routing decision есть `debug`, сохранять его только в debug mode.

### Правило debug mode
Использовать только:

```ts
process.env.NODE_ENV !== 'production'
```

Новый debug env-флаг не вводить.

---

## 6. Требования к типам

## 6.1. Единый контракт
Нужно сделать контракт максимально прямым и прозрачным.

### Предпочтительно
Использовать единый тип для результата роутера и для передачи в assistant layer, если это не ломает архитектуру.

### Допустимо
Разделить типы на:
- `ModelRoutingDecision`
- `AssistantRunOptions`

Но поля `model` и `reasoning` должны сохраняться без потерь.

---

## 6.2. Совместимость
Если где-то downstream-код всё ещё ожидает старую схему:
- `model: string`
- без `reasoning`

нужно обновить этот код.

Нельзя делать вид, что новая логика включена, если effort всё ещё фактически игнорируется.

---

## 7. Тесты

Нужно добавить или обновить тесты так, чтобы они проверяли именно **контракт propagation**.

## 7.1. Минимальный набор тестов

### Тест 1. route → runAssistant
Проверить, что после `chooseModel(...)` в `runAssistant(...)` передаётся не только `model`, но и `reasoning`.

### Тест 2. runAssistant → OpenAI layer
Проверить, что `runAssistant(...)` передаёт в OpenAI execution layer:
- правильный `model`
- правильный `reasoning.effort`

### Тест 3. Logging
Проверить, что в log payload попадает:
- `model`
- `modelReason`
- `reasoningEffort`

### Тест 4. No reasoning case
Проверить, что если router вернул модель без `reasoning`, backend работает корректно и не падает.

### Тест 5. Full strong case
Проверить кейс:
- `model = 'gpt-5.4'`
- `reasoning.effort = 'xhigh'`

и убедиться, что именно это уходит в request.

---

## 7.2. Приоритет тестов
Если тестовая база в проекте неидеальна, минимум обязательно закрыть:
- propagation contract
- request payload
- logging

---

## 8. Что искать в репозитории

BotCow должен найти и проверить минимум такие точки:

1. `route.ts`, где вызывается `chooseModel(...)` и `runAssistant(...)`
2. реализацию `runAssistant`
3. реализацию OpenAI client / request builder
4. места логирования chat events
5. тесты:
   - route tests
   - assistant tests
   - openai tests
   - router integration tests

Если фактические файлы названы иначе — ориентироваться на реальные точки входа.

---

## 9. Чего делать не нужно

Сейчас не нужно:
- заново переписывать model router, если он уже готов;
- менять логику выбора effort;
- вводить новый debug env-флаг;
- менять repo resolution;
- трогать `config/repos.yml` логику;
- делать побочный большой рефактор unrelated backend-кода.

Нужен узкий, точный контрактный апгрейд.

---

## 10. Acceptance criteria

Задача считается выполненной, если:

1. `route.ts` больше не передаёт в `runAssistant(...)` только `routing.model`.
2. `runAssistant(...)` принимает `model + reasoning` или полный routing object.
3. Реальный OpenAI request использует `reasoning.effort`, если он задан.
4. `reasoning.effort` не теряется между:
   - `chooseModel`
   - `route.ts`
   - `runAssistant`
   - OpenAI execution layer
5. В логах сохраняется `reasoningEffort`.
6. Тесты это подтверждают.
7. Поведение без `reasoning` остаётся корректным и backward-safe.

---

## 11. Практический порядок выполнения

Делать в таком порядке:

### Шаг 1
Найти фактическую реализацию:
- `runAssistant`
- OpenAI request layer
- logging

### Шаг 2
Изменить контракт `route.ts` → `runAssistant`

### Шаг 3
Изменить контракт `runAssistant` → OpenAI layer

### Шаг 4
Прокинуть `reasoning` в реальный request payload

### Шаг 5
Добавить логирование `reasoningEffort`

### Шаг 6
Обновить/добавить тесты

### Шаг 7
Проверить на реальном flow, что:
- модель доходит;
- effort доходит;
- лог это отражает.

---

## 12. Итоговая формула задачи

Нужно довести backend до состояния, в котором новый router влияет не только на выбор `model`, но и на фактический `reasoning.effort` в OpenAI request.

Иначе новый router считается интегрированным неполно.
