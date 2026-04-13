export type DevWixBudgetMode = 'normal' | 'warning' | 'aggressive';
export type BudgetPressureFamily =
  | 'none'
  | 'tokens'
  | 'db'
  | 'storage'
  | 'embeddings'
  | 'github'
  | 'vercel'
  | 'queue';

export type DevWixBudgetSnapshot = {
  budgetMode: DevWixBudgetMode;
  pressureRatio: number;
  dominantPressureFamily: BudgetPressureFamily;
  embeddingPressureRatio: number;
  dbPressureRatio: number;
  tokenPressureRatio: number;
  storagePressureRatio: number;
  githubPressureRatio: number;
  vercelPressureRatio: number;
  queuePressureRatio: number;
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

function readOptionalFiniteEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

function roundRatio(value: number): number {
  return Number(clamp(value, 0, 10).toFixed(4));
}

function resolvePressureRatio(opts: {
  ratioEnv?: string;
  usedEnv?: string;
  limitEnv?: string;
  remainingEnv?: string;
}): number {
  if (opts.ratioEnv) {
    const direct = readOptionalFiniteEnv(opts.ratioEnv);
    if (direct !== undefined) return roundRatio(direct);
  }

  const limit = opts.limitEnv ? readOptionalFiniteEnv(opts.limitEnv) : undefined;
  if (limit !== undefined && limit > 0) {
    if (opts.usedEnv) {
      const used = readOptionalFiniteEnv(opts.usedEnv);
      if (used !== undefined) return roundRatio(used / limit);
    }

    if (opts.remainingEnv) {
      const remaining = readOptionalFiniteEnv(opts.remainingEnv);
      if (remaining !== undefined) return roundRatio(1 - remaining / limit);
    }
  }

  return 0;
}

function pickDominantPressureFamily(
  entries: Array<[BudgetPressureFamily, number]>,
): { family: BudgetPressureFamily; ratio: number } {
  let family: BudgetPressureFamily = 'none';
  let ratio = 0;

  for (const [nextFamily, nextRatio] of entries) {
    if (nextRatio > ratio) {
      family = nextFamily;
      ratio = nextRatio;
    }
  }

  return { family, ratio: roundRatio(ratio) };
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

  const localEmbeddingPressureRatio = roundRatio(officialChunks / embeddingBudgetLimit);
  const localDbPressureRatio = roundRatio(officialChunks / dbBudgetLimit);

  const embeddingPressureRatio = roundRatio(
    Math.max(
      localEmbeddingPressureRatio,
      resolvePressureRatio({
        ratioEnv: 'BOTCOW_EMBEDDINGS_PRESSURE_RATIO',
        usedEnv: 'BOTCOW_EMBEDDINGS_USAGE',
        limitEnv: 'BOTCOW_EMBEDDINGS_LIMIT',
      }),
    ),
  );

  const dbPressureRatio = roundRatio(
    Math.max(
      localDbPressureRatio,
      resolvePressureRatio({
        ratioEnv: 'BOTCOW_DB_PRESSURE_RATIO',
        usedEnv: 'BOTCOW_DB_USAGE',
        limitEnv: 'BOTCOW_DB_LIMIT',
      }),
    ),
  );

  const tokenPressureRatio = resolvePressureRatio({
    ratioEnv: 'BOTCOW_MODEL_TOKEN_PRESSURE_RATIO',
    usedEnv: 'BOTCOW_MODEL_TOKEN_USAGE',
    limitEnv: 'BOTCOW_MODEL_TOKEN_LIMIT',
  });

  const storagePressureRatio = resolvePressureRatio({
    ratioEnv: 'BOTCOW_STORAGE_PRESSURE_RATIO',
    usedEnv: 'BOTCOW_STORAGE_USAGE',
    limitEnv: 'BOTCOW_STORAGE_LIMIT',
  });

  const githubPressureRatio = resolvePressureRatio({
    ratioEnv: 'BOTCOW_GITHUB_QUOTA_PRESSURE_RATIO',
    remainingEnv: 'BOTCOW_GITHUB_REQUESTS_REMAINING',
    limitEnv: 'BOTCOW_GITHUB_REQUESTS_LIMIT',
  });

  const vercelPressureRatio = resolvePressureRatio({
    ratioEnv: 'BOTCOW_VERCEL_QUOTA_PRESSURE_RATIO',
    remainingEnv: 'BOTCOW_VERCEL_REQUESTS_REMAINING',
    limitEnv: 'BOTCOW_VERCEL_REQUESTS_LIMIT',
  });

  const queuePressureRatio = resolvePressureRatio({
    ratioEnv: 'BOTCOW_ASYNC_QUEUE_PRESSURE_RATIO',
    usedEnv: 'BOTCOW_ASYNC_QUEUE_DEPTH',
    limitEnv: 'BOTCOW_ASYNC_QUEUE_LIMIT',
  });

  const dominant = pickDominantPressureFamily([
    ['tokens', tokenPressureRatio],
    ['db', dbPressureRatio],
    ['storage', storagePressureRatio],
    ['embeddings', embeddingPressureRatio],
    ['github', githubPressureRatio],
    ['vercel', vercelPressureRatio],
    ['queue', queuePressureRatio],
  ]);

  const pressureRatio = dominant.ratio;

  const budgetMode: DevWixBudgetMode =
    pressureRatio >= AGGRESSIVE_THRESHOLD ? 'aggressive' : pressureRatio >= WARNING_THRESHOLD ? 'warning' : 'normal';

  return {
    budgetMode,
    pressureRatio,
    dominantPressureFamily: dominant.family,
    embeddingPressureRatio,
    dbPressureRatio,
    tokenPressureRatio,
    storagePressureRatio,
    githubPressureRatio,
    vercelPressureRatio,
    queuePressureRatio,
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
