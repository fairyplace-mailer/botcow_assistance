import { formatDevWixContext, retrieveDevWixContext } from '../devWixDocs/retrieve';
import { logWarn } from '../log';
import { latestUserText } from '../prompt/normalizeContentToText';

export type ContextRetrievalStatus = 'not_applicable' | 'used' | 'empty' | 'failed';

export type ContextAugmentationResult = {
  instructions: string;
  retrieval: {
    status: ContextRetrievalStatus;
    source: 'dev_wix_docs' | null;
    query: string | null;
  };
};

function shouldRetrieveDevWixContext(query: string | null): boolean {
  if (!query) return false;
  return /(dev\.wix\.com|wix|velo|wix docs|wix sdk)/i.test(query);
}

function buildNoSupportSuffix(kind: 'empty' | 'failed'): string {
  if (kind === 'failed') {
    return [
      'Wix docs retrieval failed for this turn.',
      'Do not claim that Wix docs support any statement unless supporting docs context is actually present below.',
      'If the answer depends on Wix docs, explicitly say that supporting docs could not be retrieved for this turn.',
    ].join('\n');
  }

  return [
    'No relevant retrieved Wix docs context was found for this turn.',
    'Do not claim that Wix docs support any statement unless supporting docs context is actually present below.',
    'If the answer depends on Wix docs, explicitly say that supporting docs were not found for this turn.',
  ].join('\n');
}

export async function buildContextAugmentedInstructions(params: {
  instructions: string;
  messages: Array<{ role: string; content: unknown }>;
}): Promise<ContextAugmentationResult> {
  const query = latestUserText(params.messages);

  if (!shouldRetrieveDevWixContext(query)) {
    return {
      instructions: params.instructions,
      retrieval: {
        status: 'not_applicable',
        source: null,
        query,
      },
    };
  }

  const normalizedQuery = (query ?? '').trim();
  if (!normalizedQuery) {
    return {
      instructions: [params.instructions, '', buildNoSupportSuffix('empty')].join('\n'),
      retrieval: {
        status: 'empty',
        source: 'dev_wix_docs',
        query: null,
      },
    };
  }

  try {
    const retrieved = await retrieveDevWixContext({ query: normalizedQuery, topK: 4, maxChars: 5000 });
    const contextBlock = formatDevWixContext(retrieved.chunks);

    if (!contextBlock) {
      return {
        instructions: [params.instructions, '', buildNoSupportSuffix('empty')].join('\n'),
        retrieval: {
          status: 'empty',
          source: 'dev_wix_docs',
          query: normalizedQuery,
        },
      };
    }

    return {
      instructions: [
        params.instructions,
        '',
        'Use the retrieved Wix docs context below only when it is relevant and sufficient.',
        'Do not claim the docs support something unless the context below actually supports it.',
        contextBlock,
      ].join('\n'),
      retrieval: {
        status: 'used',
        source: 'dev_wix_docs',
        query: normalizedQuery,
      },
    };
  } catch (error: any) {
    await logWarn('assistant_context_retrieval_failed', {
      error: error?.message ?? String(error),
      retrievalStatus: 'failed',
      retrievalSource: 'dev_wix_docs',
      retrievalQuery: normalizedQuery,
      finalStatus: 'failed',
    });

    return {
      instructions: [params.instructions, '', buildNoSupportSuffix('failed')].join('\n'),
      retrieval: {
        status: 'failed',
        source: 'dev_wix_docs',
        query: normalizedQuery,
      },
    };
  }
}
