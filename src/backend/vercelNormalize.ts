export type NormalizedVercelDeployment = {
  id: string;
  url?: string;
  name?: string;
  projectId?: string;
  createdAt?: number;
  state?: string;
  readyState?: string;
  target?: string;
  meta?: Record<string, any>;
};

/**
 * Normalizes Vercel deployment payloads across different endpoints.
 * This must be defensive: Vercel may omit fields depending on endpoint/version.
 */
export function normalizeVercelDeployment(d: any): NormalizedVercelDeployment {
  if (!d || typeof d !== 'object') {
    return { id: String(d) };
  }

  const id = typeof d.id === 'string' ? d.id : String(d.uid ?? d.deploymentId ?? '');

  return {
    id,
    url: typeof d.url === 'string' ? d.url : undefined,
    name: typeof d.name === 'string' ? d.name : undefined,
    projectId:
      typeof d.projectId === 'string'
        ? d.projectId
        : typeof d.project === 'string'
          ? d.project
          : undefined,
    createdAt: typeof d.createdAt === 'number' ? d.createdAt : undefined,
    state: typeof d.state === 'string' ? d.state : undefined,
    readyState: typeof d.readyState === 'string' ? d.readyState : undefined,
    target: typeof d.target === 'string' ? d.target : undefined,
    meta: d.meta && typeof d.meta === 'object' ? (d.meta as Record<string, any>) : undefined,
  };
}
