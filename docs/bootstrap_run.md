# DevWix RAG запуск

## Рабочий operational режим

Для бесплатного плана использовать:

- `INGEST_BATCH=1`
- owner-triggered запуск
- без blind cron
- повторные прогоны обычно делать с `SKIP_SEED=1`

## Первый запуск

```bash
npm ci
npm run prisma:migrate
npm run prisma:generate
bash build_dev_wix_seed.sh
npm run dev
```
