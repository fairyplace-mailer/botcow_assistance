import { openai } from './openai';
import { toolSchemas, toolHandlers } from './tools';
import type {
  ChatCompletion,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';

/**
 * Сообщение для ассистента (совместимо с ChatCompletionMessageParam).
 */
type AssistantMessage = ChatCompletionMessageParam;

/**
 * Результат работы ассистента с tool calls.
 */
interface AssistantResult {
  completion: ChatCompletion | null;
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
  rawMessages: AssistantMessage[],
): Promise<AssistantResult> {
  const maxToolLoops = 10;

  let messages: AssistantMessage[] = rawMessages.slice();
  const toolCallsLog: AssistantResult['toolCalls'] = [];
  let lastCompletion: ChatCompletion | null = null;

  for (let i = 0; i < maxToolLoops; i += 1) {
    const completion: ChatCompletion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      tools: [...toolSchemas] as ChatCompletionTool[],
      tool_choice: 'auto',
    });

    lastCompletion = completion;

    const choice = completion.choices?.[0];
    if (!choice) {
      break;
    }

    const message = choice.message as ChatCompletionMessage;
    const toolCalls =
      (message.tool_calls as ChatCompletionMessageToolCall[] | null | undefined) ??
      [];

    if (toolCalls.length === 0) {
      // Модель дала финальный ответ без tool_calls — возвращаем его.
      return { completion, toolCalls: toolCallsLog };
    }

    // Есть tool_calls — выполняем их и добавляем ответы как сообщения role=tool.
    const toolResultMessages: AssistantMessage[] = [];

    for (const tc of toolCalls) {
      // Обрабатываем только function-tool calls, custom пропускаем
      if (tc.type !== 'function') {
        toolCallsLog.push({
          tool_call_id: tc.id,
          name: tc.type,
          ok: false,
          error: 'Unsupported tool call type',
        });

        toolResultMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.type,
          content: JSON.stringify({ error: 'Unsupported tool call type' }),
        } as AssistantMessage);

        continue;
      }

      const name = tc.function.name ?? '';
      const tool_call_id = tc.id;

      const rawArgs = tc.function.arguments ?? '{}';

      let args: unknown;
      try {
        args = JSON.parse(rawArgs);
      } catch {
        args = {};
      }

      const handler = toolHandlers[name as keyof typeof toolHandlers];

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
        } as AssistantMessage);

        continue;
      }

      try {
        const result = await handler(args as Record<string, unknown>);

        toolCallsLog.push({ tool_call_id, name, ok: true });

        toolResultMessages.push({
          role: 'tool',
          tool_call_id,
          name,
          content: JSON.stringify(result),
        } as AssistantMessage);
      } catch (error) {
        const err = error as Error;
        const msg = err.message || String(error);

        toolCallsLog.push({
          tool_call_id,
          name,
          ok: false,
          error: msg,
        });

        toolResultMessages.push({
          role: 'tool',
          tool_call_id,
          name,
          content: JSON.stringify({ error: msg }),
        } as AssistantMessage);
      }
    }

    // Добавляем сообщение модели с tool_calls и ответы tools в историю
    messages = [
      ...messages,
      message as unknown as AssistantMessage,
      ...toolResultMessages,
    ];
  }

  // Если вышли по лимиту итераций, но у нас есть последнее completion — возвращаем его.
  if (lastCompletion) {
    return { completion: lastCompletion, toolCalls: toolCallsLog };
  }

  return { completion: null, toolCalls: toolCallsLog };
}
