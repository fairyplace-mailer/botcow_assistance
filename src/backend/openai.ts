import OpenAI from 'openai';

import { OPENAI_EMBEDDING_MODEL } from './modelRouter';

let client: OpenAI | null = null;

/**
 * Lazily create OpenAI client.
 *
 * Important: do NOT throw at module load time.
 * Next.js can import route modules during build (e.g. "Collecting page data"),
 * and CI/build environments should not require runtime secrets.
 */
export function getOpenAIClient(): OpenAI {
  if (client) return client;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  client = new OpenAI({ apiKey });
  return client;
}

export type EmbedTextResult = {
  vector: number[];
  model: string;
  dims: number;
};

export async function embedText(input: string): Promise<EmbedTextResult> {
  const text = input.trim();
  if (!text) {
    return { vector: [], model: OPENAI_EMBEDDING_MODEL, dims: 0 };
  }

  const res = await getOpenAIClient().embeddings.create({
    model: OPENAI_EMBEDDING_MODEL,
    input: text,
  });

  const vector = res.data?.[0]?.embedding;
  if (!vector) {
    throw new Error('OpenAI embeddings: missing embedding vector');
  }

  return {
    vector,
    model: res.model ?? OPENAI_EMBEDDING_MODEL,
    dims: vector.length,
  };
}
