import OpenAI from 'openai';

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
