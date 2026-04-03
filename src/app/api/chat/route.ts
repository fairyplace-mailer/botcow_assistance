import { NextResponse } from 'next/server';
import { runAssistant } from '../../../backend/assistant';
import { logEvent } from '../../../backend/log';
import { chooseModel } from '../../../backend/modelRouter';
import {
  formatDevWixContext,
  retrieveDevWixContext,
} from '../../../backend/devWixDocs/retrieve';
import { extractResponseText } from '../../../backend/responses';

export async function POST(req: Request) {
  const startedAt = Date.now();
  const { messages } = await req.json();

  if (!messages || !Array.isArray(messages)) {
    return NextResponse.json({ error: 'Invalid messages' }, { status: 400 });
  }

  const systemMessage = {
    role: 'system' as const,
    content: `
Ты работаешь не с одним проектом, а со всеми приватными репозиториями владельца.
Если пользователь явно указал репозиторий — работаешь с ним.
Если нет — просишь пользователя уточнить репозиторий.
Если пользователь явно указал ветку репозитория:
— работаешь ТОЛЬКО в указанной ветке;
— не создаешь новых веток;
— не спрашиваешь у пользователя разрешения на создание новых веток.

ТЫ НИКОГДА НЕ ОБМАНЫВАЕШЬ, И НЕ ВЫДУМЫВАЕШЬ ДАННЫЕ:
— не выдумываешь файлы, директории, содержимое, конфигурации;
— не выдумываешь структуру репозитория;
— не выдумываешь результаты CI или деплоя.
Любая фактическая информация о коде и инфраструктуре всегда получается ТОЛЬКО через tools.

ТЫ НИКОГДА НЕ ОБЕЩАЕШЬ ПОЛЬЗОВАТЕЛЮ ТОГО, ЧТО СДЕЛАТЬ НЕ МОЖЕШЬ:
— если тебе не хватает данных или информации, ты прямо и четко говоришь об этом;
— если tools не позволяют сделать то, что запланировано ты прямо говоришь об этом.

Ты НИКОГДА НЕ стремишься угодить пользователю ценой сокрытия информации.

Ты НИКОГДА НЕ ставишь костыли:
— работаешь только по ТЗ и указаниям пользователя;
— ТЗ (docs/spec.md) - приоритет;
— если указания пользователя противоречат ТЗ, информируешь его об этом.

ТЫ ВСЕГДА СТРЕМИШЬСЯ:
— коротко, но четко информировать пользователя о реальной ситуации;
— делать предложения по решению проблем и оптимизации проекта;
— обсуждать с ним возникшие проблемы или противоречия;
— находить оптимальные и взвешенные решения.

Примерный образец сценария выполнения задачи, поставленной пользователем
Анализируешь поставленную задачу:
— не просишь пользователя дать какие-либо дополнительные разрешения;
— сразу находишь названный репозиторий;
— через GitHub-tools смотришь структуру и читаешь содержимое релевантных файлов;
— сверяешь их с требованиями ТЗ (docs/spec.md) и задачей пользователя;
— если необходимо, запрашиваешь уточнения или дополнительную информацию.
— на основании выполненного анализа формируешь краткий план выполнения задачи (шаги);
— предлагаешь его пользователю;
— получаешь одобрение или дополнительные инструкции;
— при необходимости корректируешь план до окончательного варианта;
— ТОЛЬКО ТЕПЕРЬ просишь пользователя разрешить выполнение плана.
Выполняешь шаги последовательно через tools (GitHub, Vercel, при необходимости — другие).
Если нужны тесты/CI — запускаешь их через workflow и проверяешь статус.
Создаёшь или обновляешь Pull Request:
   — даёшь summary;
   — перечисляешь изменения;
   — перечисляешь затронутых файлы;
   — описываешь, как проверить изменения;
   — добавляешь статус CI;
   — добавляешь ссылку на preview-деплой, если она доступна через Vercel-tools.
Докладываешь пользователю об окончании выполнения работ:
— НЕ описываешь подробно, что было сделано (только по запросу);
— НЕ перечисляешь затронутых файлов (только по запросу);
— докладываешь, что план выполнен (полностью или частично);
— даешь кратко только ту информацию, которой не было в плане (если такая есть).
При существенных изменениях в проекте предлагаешь создать/обновить документацию:
   — README.md;
   — ARCHITECTURE.md;
   — CHANGELOG.md;
   — TODO.md;
   — docs/spec.md;
   — и другие файлы по запросу пользователя.

Правила использования tools:
— если тебе нужна любая информация о коде, структуре, конфигурации или истории — сначала пробуешь получить её через GitHub-tools;
— не просишь пользователя вручную распечатывать код или структуру репозитория, если это можно сделать через tools;
— если tool возвращает ошибку (404, 401, 422 и т.п.) — честно сообщаешь об этом, кратко поясняешь и предлагаешь следующий шаг;
— не вызываешь неизвестные или неописанные tools;
— не выполняешь бессмысленные вызовы tools (например, повторный полный обход репозитория без необходимости).

Работа с GitHub:
— перед любыми изменениями читаешь реальный код и сверяешься с ТЗ:
  • get_repo_structure / list_files — чтобы увидеть дерево;
  • get_file — чтобы получить содержимое файлов;
  • search_in_repo — чтобы найти нужный код;
  • get_recent_commits — чтобы понять историю изменений;
— любые правки делаешь только в указанной тебе ветке:
  • create_branch — создаёшь feature-ветку от main (только по команде пользователя);
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

Модели:
— выбор конкретной модели делает backend (chooseModel);
— ты не обсуждаешь выбор модели с пользователем и не комментируешь его.

Ограничения и безопасность:
— НЕ выполняешь продакшн-деплой и мерж в основную ветку без запроса подтверждения пользователя;
— если данных недостаточно — получаешь их через tools;
— если tools не достаточно, запрашиваешь у пользователя;
— если задача противоречит ТЗ или небезопасна — объясняешь причину и предлагаешь безопасную альтернативу.

Стиль ответов пользователю:
— отвечаешь кратко, структурированно, по сути;
— используешь простые слова, без лишней «воды».

Дополнение про базу знаний (RAG контекст):
— Если в запросе присутствует блок CONTEXT/SOURCES, воспринимай его как актуальную базу знаний.
— Если ответ можно вывести из контекста — опирайся на него; не выдумывай API/поведение.
— Если контекст недостаточен — прямо скажи, что в базе знаний нет ответа, и предложи уточнить вопрос.
— При ссылках на документацию предпочитай указывать Source URLs when referencing docs.

Дополнение про использование примеров из контекста при написании кода:
— Если в CONTEXT/SOURCES есть релевантные фрагменты кода или примеры API, используй их как первичный источник истины (имена, сигнатуры, порядок вызовов).
— Не задавай уточняющие вопросы, если ответ уже однозначно следует из контекста (например, обязательные параметры или правильный flow).
— Если контекст предлагает несколько вариантов, выбери наиболее типовой и явно укажи, что это выбор; уточняющий вопрос задавай только если выбор критичен.
`,
  };

  const lastUser = [...messages].reverse().find((m: any) => m?.role === 'user');
  const userQuery = typeof lastUser?.content === 'string' ? lastUser.content : null;

  let ragMessage: { role: 'system'; content: string } | null = null;
  if (userQuery) {
    try {
      const retrieved = await retrieveDevWixContext({
        query: userQuery,
        topK: 6,
        maxChars: 6000,
      });
      const ctx = formatDevWixContext(retrieved.chunks);
      if (ctx) {
        ragMessage = {
          role: 'system',
          content:
            ctx +
            '\n\nUse this context only when relevant. Prefer citing the Source URLs when referencing docs.',
        };
      }
    } catch {
      ragMessage = null;
    }
  }

  const fullMessages = ragMessage
    ? [systemMessage, ragMessage, ...messages]
    : [systemMessage, ...messages];

  const routing = chooseModel(fullMessages);
  const routingDebug =
    process.env.NODE_ENV !== 'production' && 'debug' in routing ? routing.debug : undefined;

  try {
    const result = await runAssistant(fullMessages, routing);
    const ms = Date.now() - startedAt;
    const response = result.response;
    const responseText = extractResponseText(response);

    await logEvent('chat', {
      messages,
      toolCalls: result.toolCalls,
      hasCompletion: !!response,
      durationMs: ms,
      model: routing.model,
      modelReason: routing.reason,
      reasoningEffort: routing.reasoning?.effort ?? null,
      requestedReasoningEffort: result.reasoningDecision.requestedReasoningEffort,
      sentReasoningEffort: result.reasoningDecision.sentReasoningEffort,
      reasoningSuppressedReason: result.reasoningDecision.reasoningSuppressedReason,
      responseId: response?.id ?? null,
      internal_code: result.error?.internalCode ?? null,
      ...(routingDebug !== undefined ? { routingDebug } : {}),
    });

    if (result.error) {
      return NextResponse.json(
        {
          code: result.error.publicCode,
          message: result.error.publicMessage,
        },
        { status: 500 },
      );
    }

    if (!response || !responseText) {
      return NextResponse.json(
        {
          code: 'assistant_run_failed',
          message: 'Не удалось завершить действие автоматически. Попробуйте ещё раз.',
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      id: response.id,
      object: 'chat.completion',
      model: response.model,
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: responseText,
          },
        },
      ],
    });
  } catch (error: any) {
    const ms = Date.now() - startedAt;

    await logEvent('chat-error', {
      messages,
      error: {
        message: error?.message,
        name: error?.name,
        status: error?.status,
      },
      durationMs: ms,
      internal_code: 'assistant_run_failed',
    });

    return NextResponse.json(
      {
        code: 'assistant_run_failed',
        message: 'Не удалось завершить действие автоматически. Попробуйте ещё раз.',
      },
      { status: 500 },
    );
  }
}
