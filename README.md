# BotCow Code Assistant

Продакшн-сервис для автоматизации CI/CD и GitHub-операций через чат-интерфейс.  
Проект развивается на Vercel, использует Next.js 16, API-роуты, GitHub API, Vercel Blob и OpenAI.

## Возможности

- Общение с ассистентом (OpenAI)
- Коммиты: создание/обновление файлов в репозитории
- Ветки: создание, удаление
- Pull Request: создание, merge
- Запуск GitHub Actions workflow
- Логирование действий в Vercel Blob
- API для интеграций

## Технологии

- Next.js 16 (App Router)
- Vercel Functions
- Vercel Blob
- GitHub REST API (@octokit/rest)
- OpenAI API
- TypeScript
- PWA (Progressive Web App) с offline поддержкой

## Установка и запуск

```bash
npm install
npm run dev
```

## PWA и Offline поддержка

Проект поддерживает Progressive Web App с сервис-воркером, который обеспечивает кеширование ресурсов и fallback при offline состоянии.

### Кэширование и fallback

- Основные статические файлы и страница offline.html кешируются во время установки service worker.
- Запросы к API обслуживаются стратегией Network First с fallback на кешированные данные и страницу offline.
- Приложение отображает страницу /offline.html, если нет подключения к сети и нет кешированных данных.

### Тестирование

Для проверки offline-функционала рекомендуем использовать инструменты браузера (DevTools) с эмуляцией offline.

### Регистрация service worker

Сервис-воркер регистрируется автоматически при загрузке страницы. В консоли выводятся логи регистрации и состояния обновлений.

