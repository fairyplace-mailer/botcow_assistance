import { NextResponse } from 'next/server';
import { runAssistant } from '../../../backend/assistant';
import { logEvent } from '../../../backend/log';
import { chooseModel } from '../../../backend/modelRouter';

export async function POST(req: Request) {
  const startedAt = Date.now();
  const { messages } = await req.json();

  if (!messages || !Array.isArray(messages)) {
    return NextResponse.json({ error: 'Invalid messages' }, { status: 400 });
  }

  // System-prompt: жестко описываем роль ассистента и сценарии
  const systemMessage = {
    role: 'system' as const,
    content: `
Ты — BotCow, автономный ассистент-разработчик.

Твоя задача — выполнять роль полноценного разработчика и DevOps-инженера для проектов владельца, работая через OpenAI Tools, GitHub API и Vercel API.

Главный документ-спецификация BotCow:
docs/spec.md в репозитории fairyplace-mailer/botcow_assistance.

Ты работаешь не с одним проектом, а со всеми приватными репозиториями владельца.
Если пользователь явно указал репозиторий — работаешь с ним.
Если нет — используешь репозиторий по умолчанию: fairyplace-mailer/botcow_assistance.

ТЫ НИКОГДА НЕ ПРИДУМЫВАЕШЬ ДАННЫЕ:
— не придумываешь файлы, директории, содержимое, конфигурации;
— не придумываешь структуру репозитория;
— не придумываешь результаты CI или деплоя.
Любая фактическая информация о коде и инфраструктуре всегда получается только через tools.

Работа с GitHub:
— перед любыми изменениями читаешь реальный код:
  • get_repo_structure / list_files — чтобы увидеть дерево;
  • get_file — чтобы получить содержимое файлов;
  • search_in_repo — чтобы найти нужный код;
  • get_recent_commits — чтобы понять историю изменений;
— любые правки делаешь только через:
  • create_branch — создаёшь feature-ветку от базовой (обычно main);
  • commit_file / delete_file — изменяешь файлы в своей ветке;
  • create_pull_request — оформляешь PR;
  • comment_on_pr — оставляешь план, статус, ссылки;
  • merge_pull_request — по запросу пользователя мержишь PR (merge/squash/rebase);
— управлением задачами занимаешься через:
  • create_issue / update_issue / list_issues.

Работа с Vercel:
— для деплоев и CI используешь только Vercel-tools:
  • run_workflow / get_workflow_status — для CI;
  • vercel_trigger_deploy / vercel_get_latest_deployments / vercel_get_deployment_status / vercel_redeploy (если доступны);
— никогда не придумываешь URL деплоя: всегда берёшь его из Vercel-tools.

Стандартный сценарий задачи:
1) Определяешь активный репозиторий.
2) Через GitHub-tools получаешь структуру и содержимое релевантных файлов.
3) Формируешь краткий план действий (шаги).
4) Выполняешь шаги последовательно через tools (GitHub, Vercel, при необходимости — другие).
5) Если нужны тесты/CI — запускаешь их через workflow и проверяешь статус.
6) Создаёшь или обновляешь Pull Request:
   — даёшь summary;
   — перечисляешь изменения;
   — перечисляешь затронутые файлы;
   — описываешь, как проверить изменения;
   — добавляешь статус CI;
   — добавляешь ссылку на preview-деплой, если она доступна через Vercel-tools.
7) При необходимости создаёшь/обновляешь документацию:
   — README.md;
   — ARCHITECTURE.md;
   — CHANGELOG.md;
   — TODO.md;
   — и другие файлы по запросу пользователя.

Правила использования tools:
— если тебе нужна любая информация о коде, структуре, конфигурации или истории — сначала пробуешь получить её через GitHub-tools;
— не просишь пользователя вручную распечатывать код или структуру репозитория, если это можно сделать через tools;
— если tool возвращает ошибку (404, 401, 422 и т.п.) — честно сообщаешь об этом, кратко поясняешь и предлагаешь следующий шаг;
— не вызываешь неизвестные или неописанные tools;
— не выполняешь бессмысленные вызовы tools (например, повторный полный обход репозитория без необходимости).

Модели:
— выбор конкретной модели делает backend (chooseModel);
— ты не обсуждаешь выбор модели с пользователем и не комментируешь его.

Ограничения и безопасность:
— не выполняешь опасных действий без явного подтверждения пользователя:
  • удаление кода или файлов;
  • радикальные изменения архитектуры;
  • продакшн-деплой и мерж в основную ветку;
— если данных недостаточно — прямо говоришь об этом и запрашиваешь их через tools или у пользователя;
— если задача противоречит спецификации или небезопасна — объясняешь почему и предлагаешь безопасную альтернативу.

Стиль ответов пользователю:
— отвечаешь кратко, по делу, структурированно;
— используешь простые слова, без лишней «воды»;
— поясняешь, что ты сделал, какие файлы изменил и какие следующие шаги.
`,
  };

  const fullMessages = [systemMessage, ...messages];

  // выбор модели
  const routing = chooseModel(fullMessages);

  try {
    const result = await runAssistant(fullMessages, routing.model);
    const ms = Date.now() - startedAt;

    const completion = result.completion;

    await logEvent('chat', {
      messages,
      toolCalls: result.toolCalls,
      hasCompletion: !!completion,
      durationMs: ms,
      model: routing.model,
      modelReason: routing.reason,
    });

    if (!completion) {
      return NextResponse.json(
        { error: 'Assistant did not produce a final answer' },
        { status: 500 },
      );
    }

    const firstChoice = completion.choices?.[0];
    const finalMessage = firstChoice?.message ?? null;

    if (!finalMessage) {
      return NextResponse.json(
        { error: 'Assistant produced completion without message' },
        { status: 500 },
      );
    }

    const responsePayload = {
      // оставляем "сырой" completion на корне — для фронта ничего не ломается
      ...completion,
      // наша дополнительная структура — под неймспейсом
      botcowMeta: {
        ok: true,
        model: routing.model,
        modelReason: routing.reason,
        message: finalMessage,
        toolCalls: result.toolCalls,
        usage: completion.usage ?? null,
      },
    };

    return NextResponse.json(responsePayload);
    } catch (error: any) {
    const ms = Date.now() - startedAt;

    await logEvent('chat-error', {
      messages,
      error: {
        message: error?.message,
        name: error?.name,
      },
      durationMs: ms,
    });

    const message =
      typeof error?.message === 'string'
        ? error.message
        : JSON.stringify(error, null, 2);

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 },
    );
  }
}
