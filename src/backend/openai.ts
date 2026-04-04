import OpenAI from 'openai';

import { OPENAI_EMBEDDING_MODEL } from './modelRouter';

let client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (client) return client;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const baseURL = process.env.OPENAI_BASE_URL?.trim() || undefined;

  client = new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });

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

export type EmbedTextsResult = {
  vectors: number[][];
  model: string;
  dims: number;
};

export async function embedTexts(inputs: string[]): Promise<EmbedTextsResult> {
  const normalized = inputs.map((item) => item.trim());

  if (normalized.length === 0) {
    return { vectors: [], model: OPENAI_EMBEDDING_MODEL, dims: 0 };
  }

  if (normalized.every((item) => !item)) {
    return {
      vectors: normalized.map(() => []),
      model: OPENAI_EMBEDDING_MODEL,
      dims: 0,
    };
  }

  const res = await getOpenAIClient().embeddings.create({
    model: OPENAI_EMBEDDING_MODEL,
    input: normalized,
  });

  if (!res.data || res.data.length !== normalized.length) {
    throw new Error(
      `OpenAI embeddings: unexpected response size (got ${res.data?.length ?? 0}, expected ${normalized.length})`,
    );
  }

  const vectors = res.data.map((item) => {
    if (!item.embedding) {
      throw new Error('OpenAI embeddings: missing embedding vector');
    }
    return item.embedding;
  });

  const dims = vectors.find((item) => item.length > 0)?.length ?? 0;

  return {
    vectors,
    model: res.model ?? OPENAI_EMBEDDING_MODEL,
    dims,
  };
}
