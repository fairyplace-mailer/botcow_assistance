export type DevWixBudgetMode = 'normal' | 'warning' | 'aggressive';

export type DevWixBudgetSnapshot = {
  budgetMode: DevWixBudgetMode;
  pressureRatio: number;
  embeddingPressureRatio: number;
  dbPressureRatio: number;
  embeddingBudgetLimit: number;
  dbBudgetLimit: number;
};

export type IngestBudgetSettings = {
  maxEmbeddings: number;
  maxChunksPerPage: number;
  chunkTokens: number;
  overlapTokens: number;
};

export type RetrievalBudgetSettings = {
  topK: number;
  maxChars: number;
  probeLimit: number;
};

const WARNING_THRESHOLD = 0.7;
const AGGRESSIVE_THRESHOLD = 0.9;
const DEFAULT_EMBEDDING_BUDGET_LIMIT = 20000;
const DEFAULT_DB_BUDGET_LIMIT = 20000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function roundRatio(value: number): number {
  return Number(clamp(value, 0, 10).toFixed(4));
}

export function computeDevWixBudgetSnapshot(opts: {
  officialChunks: number;
  embeddingBudgetLimit?: number;
  dbBudgetLimit?: number;
}): DevWixBudgetSnapshot {
  const embeddingBudgetLimit = Math.max(
    1,
    Math.floor(
      opts.embeddingBudgetLimit ??
        readPositiveIntEnv('BOTCOW_DEV_WIX_EMBEDDING_BUDGET_LIMIT', DEFAULT_EMBEDDING_BUDGET_LIMIT),
    ),
  );
  const dbBudgetLimit = Math.max(
    1,
    Math.floor(
      opts.dbBudgetLimit ?? readPositiveIntEnv('BOTCOW_DEV_WIX_DB_BUDGET_LIMIT', DEFAULT_DB_BUDGET_LIMIT),
    ),
  );
  const officialChunks = Math.max(0, Math.floor(opts.officialChunks));

  const embeddingPressureRatio = roundRatio(officialChunks / embeddingBudgetLimit);
  const dbPressureRatio = roundRatio(officialChunks / dbBudgetLimit);
  const pressureRatio = roundRatio(Math.max(embeddingPressureRatio, dbPressureRatio));

  const budgetMode: DevWixBudgetMode =
    pressureRatio >= AGGRESSIVE_THRESHOLD ? 'aggressive' : pressureRatio >= WARNING_THRESHOLD ? 'warning' : 'normal';

  return {
    budgetMode,
    pressureRatio,
    embeddingPressureRatio,
    dbPressureRatio,
    embeddingBudgetLimit,
    dbBudgetLimit,
  };
}

export function applyDevWixIngestDegradation(
  mode: DevWixBudgetMode,
  settings: IngestBudgetSettings,
): IngestBudgetSettings {
  if (mode === 'normal') return settings;

  if (mode === 'warning') {
    return {
      maxEmbeddings: Math.max(1, Math.floor(settings.maxEmbeddings * 0.5)),
      maxChunksPerPage: Math.max(1, Math.floor(settings.maxChunksPerPage * 0.5)),
      chunkTokens: clamp(Math.floor(settings.chunkTokens * 0.75), 500, 1000),
      overlapTokens: clamp(Math.floor(settings.overlapTokens * 0.5), 0, 200),
    };
  }

  return {
    maxEmbeddings: 0,
    maxChunksPerPage: 1,
    chunkTokens: clamp(Math.floor(settings.chunkTokens * 0.6), 500, 1000),
    overlapTokens: 0,
  };
}

export function applyDevWixRetrievalDegradation(
  mode: DevWixBudgetMode,
  settings: RetrievalBudgetSettings,
): RetrievalBudgetSettings {
  if (mode === 'normal') return settings;

  if (mode === 'warning') {
    const topK = Math.max(1, Math.min(settings.topK, Math.ceil(settings.topK * 0.5)));
    return {
      topK,
      maxChars: Math.max(1200, Math.min(settings.maxChars, Math.floor(settings.maxChars * 0.6))),
      probeLimit: Math.max(topK, Math.min(settings.probeLimit, Math.ceil(settings.probeLimit * 0.5))),
    };
  }

  const topK = Math.max(1, Math.min(settings.topK, 2));
  return {
    topK,
    maxChars: Math.max(900, Math.min(settings.maxChars, 1500)),
    probeLimit: Math.max(topK, Math.min(settings.probeLimit, Math.max(topK, 3))),
  };
}
