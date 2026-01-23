import { diagnoseVercelDeployment } from '../diagnostics/vercelDiagnostics';
import { getLatestDeployments } from '../vercel';
import { normalizeVercelDeployment } from '../vercelNormalize';
import { logEvent } from '../log';

type VercelTarget = 'preview';

export type PreviewGetUrlArgs = {
  /** owner/name. If omitted, uses BOTCOW_DEFAULT_REPO */
  repo?: string;
  git_sha?: string;
  branch?: string;
  target?: VercelTarget;
  timeWindowMinutes?: number;
};

export type PreviewGetUrlResult = {
  ok: true;
  repo?: string;
  deploymentId: string;
  url: string; // full https url
  state?: string;
  readyState?: string;
  matchedBy: 'git_sha' | 'branch' | 'latest';
};

function requirePreviewTarget(target?: VercelTarget): VercelTarget {
  if (!target) return 'preview';
  if (target === 'preview') return 'preview';
  throw new Error('Only preview target is allowed');
}

function ensureHttpsUrl(url: string): string {
  if (!url) throw new Error('Missing preview URL');
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

function isAllowedPreviewHost(hostname: string): boolean {
  // Strict allowlist: only Vercel preview domains.
  // This intentionally does NOT allow arbitrary domains to avoid SSRF.
  return (
    hostname.endsWith('.vercel.app') ||
    hostname.endsWith('.vercel.app.')
  );
}

function assertAllowedPreviewUrl(baseUrl: string) {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid preview baseUrl: ${baseUrl}`);
  }
  if (u.protocol !== 'https:') {
    throw new Error('Only https preview URLs are allowed');
  }
  if (!isAllowedPreviewHost(u.hostname)) {
    throw new Error(`Preview host is not allowed: ${u.hostname}`);
  }
}

async function findPreviewUrl(args: PreviewGetUrlArgs): Promise<PreviewGetUrlResult> {
  const target = requirePreviewTarget(args.target);

  // Prefer full diagnose (it already knows how to find by sha/branch and returns rich info)
  if (args.git_sha || args.branch) {
    const diag = await diagnoseVercelDeployment({
      ...(args.repo ? { repo: args.repo } : {}),
      ...(args.git_sha ? { git_sha: args.git_sha } : {}),
      ...(args.branch ? { branch: args.branch } : {}),
      ...(target ? { target } : {}),
      ...(args.timeWindowMinutes !== undefined
        ? { timeWindowMinutes: args.timeWindowMinutes }
        : {}),
    });

    const dep = (diag as any)?.deployment;
    if (dep?.id && dep?.url) {
      return {
        ok: true,
        repo: args.repo,
        deploymentId: String(dep.id),
        url: ensureHttpsUrl(String(dep.url)),
        state: dep.state,
        readyState: dep.readyState,
        matchedBy: args.git_sha ? 'git_sha' : 'branch',
      };
    }
  }

  // Fallback: latest deployment
  const latest = await getLatestDeployments(target);
  const first = Array.isArray(latest) ? latest[0] : undefined;
  if (!first) throw new Error('No preview deployments found');

  const normalized = normalizeVercelDeployment(first as any);
  if (!normalized?.id || !normalized?.url) {
    throw new Error('Latest preview deployment has no id/url');
  }

  return {
    ok: true,
    repo: args.repo,
    deploymentId: String(normalized.id),
    url: ensureHttpsUrl(String(normalized.url)),
    state: normalized.state,
    readyState: normalized.readyState,
    matchedBy: 'latest',
  };
}

export type PreviewHttpRequestArgs = {
  baseUrl: string;
  path: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  maxResponseChars?: number;
};

export type PreviewHttpResponse = {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  bodyText: string;
};

async function previewHttpRequest(args: PreviewHttpRequestArgs): Promise<PreviewHttpResponse> {
  const baseUrl = args.baseUrl;
  assertAllowedPreviewUrl(baseUrl);

  const path = args.path?.startsWith('/') ? args.path : `/${args.path ?? ''}`;
  const url = new URL(path, baseUrl).toString();

  const method = args.method ?? 'GET';
  const timeoutMs = args.timeoutMs ?? 15000;
  const maxChars = args.maxResponseChars ?? 256_000;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = {
      ...(args.headers ?? {}),
    };

    let body: string | undefined;
    if (method !== 'GET' && args.body !== undefined) {
      // Default JSON encoding
      if (!headers['content-type'] && !headers['Content-Type']) {
        headers['content-type'] = 'application/json';
      }
      body = typeof args.body === 'string' ? args.body : JSON.stringify(args.body);
    }

    const res = await fetch(url, {
      method,
      headers,
      body,
      redirect: 'follow',
      signal: controller.signal,
    });

    const text = await res.text();

    const limited = text.length > maxChars ? text.slice(0, maxChars) : text;
    const outHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      // avoid huge headers
      outHeaders[k] = String(v).slice(0, 2000);
    });

    return {
      ok: res.ok,
      status: res.status,
      headers: outHeaders,
      bodyText: limited,
    };
  } finally {
    clearTimeout(t);
  }
}

export type PreviewSmokeCheckArgs = {
  repo?: string;
  git_sha?: string;
  branch?: string;
};

export type PreviewSmokeCheckResult = {
  preview: PreviewGetUrlResult;
  checks: Array<{
    name: string;
    ok: boolean;
    status?: number;
    error?: string;
  }>;
};

function safeJsonParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const previewToolsSchemas = [
  {
    type: 'function',
    function: {
      name: 'preview_get_url',
      description: 'Get Vercel preview URL for a given repo/sha/branch (preview only).',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string' },
          git_sha: { type: 'string' },
          branch: { type: 'string' },
          target: { type: 'string', enum: ['preview'] },
          timeWindowMinutes: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'preview_http_request',
      description:
        'Perform a safe HTTP request to a Vercel preview deployment URL (SSRF-protected).',
      parameters: {
        type: 'object',
        properties: {
          baseUrl: { type: 'string' },
          path: { type: 'string' },
          method: { type: 'string', enum: ['GET', 'POST'] },
          headers: {
            type: 'object',
            additionalProperties: { type: 'string' },
          },
          body: {},
          timeoutMs: { type: 'number' },
          maxResponseChars: { type: 'number' },
        },
        required: ['baseUrl', 'path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'preview_smoke_check',
      description:
        'Find latest Vercel preview URL and run a small set of HTTP/tool checks against it.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string' },
          git_sha: { type: 'string' },
          branch: { type: 'string' },
        },
      },
    },
  },
] as const;

export const previewToolHandlers = {
  async preview_get_url(args: PreviewGetUrlArgs) {
    const result = await findPreviewUrl(args ?? {});
    logEvent('preview_get_url', {
      repo: result.repo,
      deploymentId: result.deploymentId,
      matchedBy: result.matchedBy,
      state: result.state,
      readyState: result.readyState,
    });
    return result;
  },

  async preview_http_request(args: PreviewHttpRequestArgs) {
    const res = await previewHttpRequest(args);
    logEvent('preview_http_request', {
      baseUrl: args.baseUrl,
      path: args.path,
      method: args.method ?? 'GET',
      status: res.status,
      ok: res.ok,
    });
    return res;
  },

  async preview_smoke_check(args: PreviewSmokeCheckArgs): Promise<PreviewSmokeCheckResult> {
    const preview = await findPreviewUrl({
      ...(args?.repo ? { repo: args.repo } : {}),
      ...(args?.git_sha ? { git_sha: args.git_sha } : {}),
      ...(args?.branch ? { branch: args.branch } : {}),
    });

    const checks: PreviewSmokeCheckResult['checks'] = [];

    async function run(name: string, fn: () => Promise<void>) {
      try {
        await fn();
        checks.push({ name, ok: true });
      } catch (e: any) {
        checks.push({ name, ok: false, error: e?.message ?? String(e) });
      }
    }

    await run('GET /', async () => {
      const r = await previewHttpRequest({ baseUrl: preview.url, path: '/', method: 'GET' });
      if (!(r.status >= 200 && r.status < 400)) {
        throw new Error(`Unexpected status: ${r.status}`);
      }
    });

    await run('GET /tools', async () => {
      const r = await previewHttpRequest({ baseUrl: preview.url, path: '/tools', method: 'GET' });
      if (r.status !== 200) throw new Error(`Unexpected status: ${r.status}`);
      const json = safeJsonParse(r.bodyText);
      if (!json || !Array.isArray(json.tools)) throw new Error('Invalid /tools response');
    });

    // Helper to call /tools/call on the preview (requires admin token header from caller)
    const adminToken = process.env.BOTCOW_ADMIN_TOKEN;
    const authHeader = adminToken ? { Authorization: `Bearer ${adminToken}` } : undefined;

    await run('POST /tools/call github_get_repo_structure', async () => {
      const r = await previewHttpRequest({
        baseUrl: preview.url,
        path: '/tools/call',
        method: 'POST',
        headers: authHeader,
        body: {
          name: 'github_get_repo_structure',
          arguments: {
            repo: args?.repo ?? process.env.BOTCOW_DEFAULT_REPO,
            ref: 'provecta',
            pathPrefix: 'src/backend',
          },
        },
      });
      if (r.status !== 200) throw new Error(`Unexpected status: ${r.status}`);
      const json = safeJsonParse(r.bodyText);
      if (!json?.ok) throw new Error('Tool call failed');
    });

    await run('POST /tools/call github_get_file', async () => {
      const r = await previewHttpRequest({
        baseUrl: preview.url,
        path: '/tools/call',
        method: 'POST',
        headers: authHeader,
        body: {
          name: 'github_get_file',
          arguments: {
            repo: args?.repo ?? process.env.BOTCOW_DEFAULT_REPO,
            ref: 'provecta',
            path: 'docs/spec.md',
          },
        },
      });
      if (r.status !== 200) throw new Error(`Unexpected status: ${r.status}`);
      const json = safeJsonParse(r.bodyText);
      if (!json?.ok) throw new Error('Tool call failed');
    });

    await run('POST /tools/call github_self_check_search_schema', async () => {
      const r = await previewHttpRequest({
        baseUrl: preview.url,
        path: '/tools/call',
        method: 'POST',
        headers: authHeader,
        body: {
          name: 'github_self_check_search_schema',
          arguments: {},
        },
      });
      if (r.status !== 200) throw new Error(`Unexpected status: ${r.status}`);
      const json = safeJsonParse(r.bodyText);
      if (!json?.ok) throw new Error('Tool call failed');
    });

    await run('POST /tools/call github_search_in_repo (narrow)', async () => {
      const repo = args?.repo ?? process.env.BOTCOW_DEFAULT_REPO;
      const r = await previewHttpRequest({
        baseUrl: preview.url,
        path: '/tools/call',
        method: 'POST',
        headers: authHeader,
        body: {
          name: 'github_search_in_repo',
          arguments: {
            repo,
            query: `repo:${repo} filename:package.json`,
            per_page: 5,
          },
        },
      });
      if (r.status !== 200) throw new Error(`Unexpected status: ${r.status}`);
      const json = safeJsonParse(r.bodyText);
      if (!json?.ok) throw new Error('Tool call failed');
    });

    return { preview, checks };
  },
} as const;
