Этот файл относится к DevWix seed manifest.

Собрать seed:
bash build_dev_wix_seed.sh

Собрать seed в другой путь:
bash build_dev_wix_seed.sh /path/to/dev_wix.seed.txt

После сборки основной запуск RAG:
bash bootstrap_wix_rag.sh http://localhost:3000 "$BOTCOW_ADMIN_TOKEN" 100 25 200

Актуальные admin endpoints:
POST /api/admin/devwix/seed
POST /api/admin/devwix/ingest
GET  /api/admin/devwix/status

Auth:
Authorization: Bearer <BOTCOW_ADMIN_TOKEN>
