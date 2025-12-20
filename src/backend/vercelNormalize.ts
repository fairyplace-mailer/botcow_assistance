export type VercelTarget = 'preview' | 'production';

/**
 * Normalized Vercel deployment shape used across backend layers.
 *
 * Notes:
 * - We use `null` (not `undefined`) for missing fields to keep the shape stable.
 * - This avoids `exactOptionalPropertyTypes` pitfalls and reduces contract drift.
 */
export type NormalizedVercelDeployment = {
  id: string;
  url: string | null;
  state: string | null;
  readyState: string | null;
  createdAt: number | null;
  target: string | null;
  name: string | null;
  projectId: string | null;
  inspectorUrl: string | null;
  meta: Record<string, unknown> | null;
};

/**
 * Normalizes Vercel deployment payloads across different endpoints.
 * This must be defensive: Vercel may omit fields depending on endpoint/version.
 */
export function normalizeVercelDeployment(raw: any): NormalizedVercelDeployment {
  if (!raw || typeof raw !== 'object') {
    return {
      id: '',
      url: null,
      state: null,
      readyState: null,
      createdAt: null,
      target: null,
      name: null,
      projectId: null,
      inspectorUrl: null,
      meta: null,
    };
  }

  const id =
    (typeof raw.id === 'string' && raw.id) ||
    (typeof raw.uid === 'string' && raw.uid) ||
    (typeof raw.deploymentId === 'string' && raw.deploymentId) ||
    '';

  const url = typeof raw.url === 'string' ? raw.url : null;

  const createdAt =
    (typeof raw.createdAt === 'number' && raw.createdAt) ||
    (typeof raw.created === 'number' && raw.created) ||
    null;

  const state =
    (typeof raw.state === 'string' && raw.state) ||
    (typeof raw.status === 'string' && raw.status) ||
    null;

  const readyState =
    (typeof raw.readyState === 'string' && raw.readyState) || state;

  const target = typeof raw.target === 'string' ? raw.target : null;

  const name = typeof raw.name === 'string' ? raw.name : null;

  const projectId =
    typeof raw.projectId === 'string'
      ? raw.projectId
      : typeof raw.project === 'string'
        ? raw.project
        : null;

  const inspectorUrl =
    typeof raw.inspectorUrl === 'string' ? raw.inspectorUrl : null;

  const meta =
    raw.meta && typeof raw.meta === 'object'
      ? (raw.meta as Record<string, unknown>)
      : null;

  return {
    id,
    url,
    state,
    readyState,
    createdAt,
    target,
    name,
    projectId,
    inspectorUrl,
    meta,
  };
}
