Да. Вот **порядок запуска с нуля**, по шагам.

## 1. Перейди в корень проекта бота

```bash
cd /путь/к/проекту
```

Проверь, что ты в корне:

```bash
ls
```

Там должны быть примерно:

* `package.json`
* `prisma/`
* `src/`

---

## 2. Создай seed-файл

Создай папку и файл:

```bash
mkdir -p docs/rag
touch docs/rag/dev_wix.seed.txt
```

Если seed уже собран — пропусти этот шаг.

---

## 3. Создай скрипт генерации seed

Создай файл:

```bash
touch build_dev_wix_seed.sh
chmod +x build_dev_wix_seed.sh
```

Вставь в него **полную финальную версию** `build_dev_wix_seed.sh`.

Запусти:

```bash
bash build_dev_wix_seed.sh
```

Проверь:

```bash
wc -l docs/rag/dev_wix.seed.txt
head -20 docs/rag/dev_wix.seed.txt
```

---

## 4. Добавь код RAG в проект

Нужно, чтобы в проекте уже были:

* Prisma models `KnowledgeSource`, `KnowledgeJob`, `KnowledgeDocument`, `KnowledgeChunk`
* файлы из `src/backend/rag/...`
* admin routes:

  * `/api/admin/rag/bootstrap`
  * `/api/admin/rag/run`
  * `/api/admin/rag/status`

---

## 5. Установи зависимости

```bash
npm i cheerio turndown
```

Если используешь `pnpm`:

```bash
pnpm add cheerio turndown
```

---

## 6. Примени миграцию Prisma

Сначала создай миграцию:

```bash
npx prisma migrate dev --name add_knowledge_bootstrap
```

Потом проверь Prisma client:

```bash
npx prisma generate
```

---

## 7. Выставь переменные окружения

Нужны минимум:

```bash
export BOTCOW_ADMIN_TOKEN="your_admin_token_here"
export OPENAI_API_KEY="your_openai_api_key_here"
```

Если проект использует `.env.local`, запиши туда:

```env
BOTCOW_ADMIN_TOKEN=your_admin_token_here
OPENAI_API_KEY=your_openai_api_key_here
```

---

## 8. Запусти бота локально

Например:

```bash
npm run dev
```

или

```bash
pnpm dev
```

Проверь, что сервер поднялся на:

```text
http://localhost:3000
```

---

## 9. Создай launcher для bootstrap

Создай файл:

```bash
touch bootstrap_wix_rag.sh
chmod +x bootstrap_wix_rag.sh
```

Вставь в него полный текст `bootstrap_wix_rag.sh`.

---

## 10. Запусти bootstrap

Из корня проекта:

```bash
bash bootstrap_wix_rag.sh
```

Если token не подхватился:

```bash
bash bootstrap_wix_rag.sh http://localhost:3000 YOUR_ADMIN_TOKEN 10 500
```

Где:

* `10` — batch size
* `500` — max loops

---

## 11. Что должно произойти

Скрипт сам:

1. вызовет `POST /api/admin/rag/bootstrap`
2. создаст source/job/documents
3. потом начнёт батчами вызывать `POST /api/admin/rag/run`
4. в конце вызовет `GET /api/admin/rag/status`

---

## 12. Как проверить, что всё реально работает

### Seed есть

```bash
wc -l docs/rag/dev_wix.seed.txt
```

### База наполняется

Можно открыть Prisma Studio:

```bash
npx prisma studio
```

И посмотреть таблицы:

* `KnowledgeSource`
* `KnowledgeJob`
* `KnowledgeDocument`
* `KnowledgeChunk`

### API status живой

```bash
curl http://localhost:3000/api/admin/rag/status \
  -H "x-admin-token: $BOTCOW_ADMIN_TOKEN"
```

---

## 13. Минимальный успешный результат

После завершения у тебя должно быть:

* 1 source
* 1+ job
* много `KnowledgeDocument`
* много `KnowledgeChunk`
* у части документов статус `READY`

---

## 14. Самый безопасный первый прогон

Первый раз лучше не гнать всё вслепую.
Сделай так:

### временно укороти seed до 10–20 URL

Потом запусти bootstrap.

Когда увидишь, что:

* extraction нормальный
* markdown не пустой
* chunks создаются
* embeddings строятся

тогда уже верни полный seed и запусти снова.

---

## 15. Коротко: весь порядок одной цепочкой

```bash
cd /путь/к/проекту
mkdir -p docs/rag
bash build_dev_wix_seed.sh
npm i cheerio turndown
npx prisma migrate dev --name add_knowledge_bootstrap
npx prisma generate
export BOTCOW_ADMIN_TOKEN="your_admin_token_here"
export OPENAI_API_KEY="your_openai_api_key_here"
npm run dev
bash bootstrap_wix_rag.sh
```

Если упрёшься в ошибку, пришли вывод этих 3 команд:

```bash
wc -l docs/rag/dev_wix.seed.txt
curl http://localhost:3000/api/admin/rag/status -H "x-admin-token: $BOTCOW_ADMIN_TOKEN"
npx prisma migrate status
```