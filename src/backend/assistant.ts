import { openai } from './openai';
import { toolSchemas, toolHandlers } from './tools';

type AnyMessage = {
  role: string;
  [key: string]: any;
};

interface AssistantResult {
  completion: any | null;
  toolCalls: Array<{
    tool_call_id: string;
    name: string;
    ok: boolean;
    error?: string;
  }>;
}

/**
 * Ассистент с поддержкой tools (GitHub + Vercel).
 * На вход: массив сообщений { role, content } (с system-сообщением уже включённым выше по стеку).
 */
export async function runAssistant(
  rawMessages: AnyMessage[],
): Promise<AssistantResult> {
  const maxToolLoops = 10;
  let messages: AnyMessage[] = rawMessages.slice();
  const toolCallsLog: AssistantResult['toolCalls'] = [];
  let lastCompletion: any = null;

  for (let i = 0; i < maxToolLoops; i += 1) {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: messages as any,
      tools: toolSchemas as any,
      tool_choice: 'auto',
    });

    lastCompletion = completion;

    const choice = completion.choices?.[0];
    if (!choice) {
      break;
    }

    const message: AnyMessage = choice.message as any;

    const toolCalls = (message as any).tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      // Модель дала финальный ответ без tool_calls — возвращаем его.
      return { completion, toolCalls: toolCallsLog };
    }

    // Есть tool_calls — выполняем их и добавляем ответы как сообщения role=tool.
    const toolResultMessages: AnyMessage[] = [];

    for (const tc of toolCalls) {
      const name = tc.function?.name as string;
      const tool_call_id = tc.id as string;
      const rawArgs = tc.function?.arguments ?? '{}';

      let args: any = {};
      try {
        args = JSON.parse(rawArgs);
      } catch {
        args = {};
      }

      const handler = (toolHandlers as any)[name];

      if (!handler) {
        toolCallsLog.push({
          tool_call_id,
          name,
          ok: false,
          error: 'Unknown tool',
        });
        toolResultMessages.push({
          role: 'tool',
          tool_call_id,
          name,
          content: JSON.stringify({ error: 'Unknown tool' }),
        });
        continue;
      }

      try {
        const result = await handler(args);
        toolCallsLog.push({ tool_call_id, name, ok: true });

        toolResultMessages.push({
          role: 'tool',
          tool_call_id,
          name,
          content: JSON.stringify(result),
        });
      } catch (error: any) {
        const msg = error?.message || String(error);
        toolCallsLog.push({ tool_call_id, name, ok: false, error: msg });

        toolResultMessages.push({
          role: 'tool',
          tool_call_id,
          name,
          content: JSON.stringify({ error: msg }),
        });
      }
    }

    // Добавляем сообщение модели с tool_calls и ответы tools в историю
    messages = [...messages, message, ...toolResultMessages];
  }

  // Если вышли по лимиту итераций, но у нас есть последнее completion — возвращаем его.
  if (lastCompletion) {
    return { completion: lastCompletion, toolCalls: toolCallsLog };
  }

  return { completion: null, toolCalls: toolCallsLog };
}
