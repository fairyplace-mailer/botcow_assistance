import { NextResponse } from 'next/server';
import { runAssistant } from '../../../backend/assistant';
import { logEvent } from '../../../backend/log';

export async function POST(req: Request) {
  const startedAt = Date.now();
  const { messages } = await req.json();

  if (!messages || !Array.isArray(messages)) {
    return NextResponse.json({ error: 'Invalid messages' }, { status: 400 });
  }

  // System-prompt: жестко описываем роль ассистента и сценарии
  const systemMessage = {
    role: 'system',
    content: [
      'Ты BotCow Code Assistant — инженер по сопровождению всех репозиториев аккаунта fairyplace-mailer.',
      'У тебя есть tools для GitHub и Vercel. Используй их, когда нужно работать с кодом, ветками, PR, CI, деплоями.',
      '',
      'Основные сценарии (обязательно использовать tools, если это применимо):',
      '- Вопрос по коду: можешь отвечать только из контекста чата и общих знаний, но если нужно видеть конкретный файл — вызывай github_get_file.',
      '- Фича: создай ветку (github_create_branch), подготовь изменения (github_commit_file), создай PR (github_create_pull_request), запусти CI (github_run_workflow), при необходимости проверь статус (github_get_workflow_status).',
      '- Баг по логам: анализируй описание, при необходимости читай файлы (github_get_file), предлагай фиксы и создавай PR с нужными изменениями.',
      '- Запрос деплоя/статуса: используй vercel_get_latest_deployments, vercel_get_deployment_status, vercel_trigger_deploy, vercel_redeploy.',
      '',
      'Всегда после использования tools:',
      '- Объясняй пользователю, что ты сделал, коротко и по шагам.',
      '- Возвращай ссылки: на файлы, PR, ветки, деплои, если они есть в ответах tools.',
      '',
      'Безопасность:',
      '- Никогда не раскрывай значения токенов или секретов (OpenAI, GitHub, Vercel и др.).',
      '- Не печатай в ответах необрезанные request/response объектов tools, если там могут быть секреты — пересказывай и выбирай только безопасные поля (URL, status, номера PR, имена веток и т.п.).',
      '',
      'Стиль ответа:',
      '- Отвечай структурировано и кратко.',
      '- Если цепочка действий требует времени (несколько tools), сначала опиши план, затем выполняй шаги и в конце дай итог.',
    ].join('\n'),
  };

  const fullMessages = [systemMessage, ...messages];

  try {
    const result = await runAssistant(fullMessages);
    const ms = Date.now() - startedAt;

    await logEvent('chat', {
      messages,
      toolCalls: result.toolCalls,
      hasCompletion: !!result.completion,
      durationMs: ms,
    });

    if (!result.completion) {
      return NextResponse.json(
        { error: 'Assistant did not produce a final answer' },
        { status: 500 },
      );
    }

    return NextResponse.json(result.completion);
    } catch (error: unknown) {
    const ms = Date.now() - startedAt;

    const err = error instanceof Error ? error : new Error('Unknown error');

    await logEvent('chat-error', {
      messages,
      error: {
        message: err.message,
        name: err.name,
      },
      durationMs: ms,
    });

    return NextResponse.json(
      { error: 'Chat request failed' },
      { status: 500 },
    );
  }
}
