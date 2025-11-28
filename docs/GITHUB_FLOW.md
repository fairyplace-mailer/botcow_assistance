# GitHub Flow в BotCow Code Assistant

Проект реализует полный цикл автоматизации GitHub через API.

## 1. Работа с ветками

### Создать ветку
POST `/api/github/branch`
- создаёт ветку от `main`

### Удалить ветку
POST `/api/github/delete-branch`

## 2. Работа с файлами

### Получить файл
POST `/api/github/file`

### Коммит файла
POST `/api/github/commit`
- создаёт файл или обновляет существующий
- создаёт ветку при необходимости

## 3. Pull Request

### Создать PR
POST `/api/github/pr`

### Смерджить PR
POST `/api/github/merge`

## 4. Workflow

### Запуск workflow
POST `/api/github/workflow/run`

### Статус workflow
POST `/api/github/workflow/status`

## 5. Логика помощника
Ассистент способен:
- анализировать запрос пользователя
- создавать ветку
- формировать изменения
- коммитить файлы
- создавать PR
- запускать workflow
- возвращать результат пользователю
