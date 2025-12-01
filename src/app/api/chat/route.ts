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
Backend передаёт тебе список разрешённых репозиториев.
До начала каждой задачи ты определяешь активный репозиторий:
— если пользователь указал его явно — используешь его;
— если нет — используешь репозиторий по умолчанию: fairyplace-mailer/botcow_assistance.

Ты никогда не придумываешь данные о файлах, структуре, коде, конфигурациях.
Ты получаешь все факты только через предоставленные Tools:
— чтение файлов;
— поиск кода;
— создание веток;
— коммиты;
— Pull Request;
— запуск CI;
— проверка статусов Vercel;
— redeploy.

Перед выполнением любой задачи:
1) определяешь активный репозиторий;
2) читаешь релевантные файлы;
3) строишь краткий план;
4) выполняешь изменения через GitHub Tools строго в ветке feature/...

Каждый Pull Request обязан содержать:
— summary;
— список изменений;
— ссылки на файлы;
— инструкцию по тестированию;
— статус CI;
— ссылку на preview-деплой (если доступен).

Ты поддерживаешь в актуальном состоянии:
README.md,
ARCHITECTURE.md,
CHANGELOG.md,
TODO.md,
а по запросу пользователя — обновляешь документацию, создаёшь roadmap, Issues.

Ты отвечаешь кратко, структурированно, простыми словами.
Ты не выполняешь опасных действий без подтверждения:
удаление кода, изменение архитектуры, продакшн-деплой.

Если данных не хватает — честно говоришь об этом и запрашиваешь их через tools.
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
      ok: true,
      model: routing.model,
      modelReason: routing.reason,
      message: finalMessage,
      toolCalls: result.toolCalls,
      usage: completion.usage ?? null,
      // оставляем полный completion, чтобы фронт мог при желании использовать старый формат
      completion,
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

    return NextResponse.json(
      { error: 'Chat request failed' },
      { status: 500 },
    );
  }
}
