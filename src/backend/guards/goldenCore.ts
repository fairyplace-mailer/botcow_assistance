const GOLDEN_CORE_FILES = new Set([
  'src/app/api/chat/route.ts',
  'src/backend/assistant.ts',
  'src/backend/modelRouter.ts',
  'src/backend/openai.ts',
  'src/backend/openaiRuntime.ts',
  'src/backend/responses.ts',
]);

const GOLDEN_CORE_PREFIXES = [
  'src/backend/prompt/',
  'src/backend/contracts/',
  'src/backend/guards/',
  'tests/contracts/',
];

function normalizePath(file: string): string {
  return String(file ?? '').replace(/\\/g, '/').replace(/^\.?\//, '').trim();
}

export function isGoldenCorePath(file: string): boolean {
  const normalized = normalizePath(file);
  if (!normalized) return false;
  if (GOLDEN_CORE_FILES.has(normalized)) return true;
  return GOLDEN_CORE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function hasGoldenCoreTouch(files: string[] | undefined): boolean {
  return (files ?? []).some(isGoldenCorePath);
}
