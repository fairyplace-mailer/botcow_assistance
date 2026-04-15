import { formatDevWixContext, retrieveDevWixContext } from '../devWixDocs/retrieve';
import { logWarn } from '../log';
import { latestUserText } from '../prompt/normalizeContentToText';

function shouldRetrieveDevWixContext(query: string | null): boolean {
  if (!query) return false;
  return /(dev\.wix\.com|wix|velo|wix docs|wix sdk)/i.test(query);
}

export async function buildContextAugmentedInstructions(params: {
  instructions: string;
  messages: Array<{ role: string; content: unknown }>;
}): Promise<string> {
  const query = latestUserText(params.messages);
  if (!shouldRetrieveDevWixContext(query)) return params.instructions;

  const normalizedQuery = (query ?? '').trim();
  if (!normalizedQuery) return params.instructions;

  try {
    const retrieved = await retrieveDevWixContext({ query: normalizedQuery, topK: 4, maxChars: 5000 });
    const contextBlock = formatDevWixContext(retrieved.chunks);
    if (!contextBlock) return params.instructions;

    return [
      params.instructions,
      '',
      'Use the retrieved Wix docs context below only when it is relevant and sufficient.',
      'Do not claim the docs support something unless the context below actually supports it.',
      contextBlock,
    ].join('\n');
  } catch (error: any) {
    await logWarn('assistant_context_retrieval_failed', {
      error: error?.message ?? String(error),
      finalStatus: 'failed',
    });
    return params.instructions;
  }
}
