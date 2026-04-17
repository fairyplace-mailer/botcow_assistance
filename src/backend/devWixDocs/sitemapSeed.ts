const DEFAULT_START_URL = 'https://dev.wix.com/docs';

// If Wix ever exposes localized docs under /docs/<lang>/..., ignore those.
const LANG_PREFIX_RE = /^\/docs\/(?!rest\/|sdk\/|api\/|reference\/)([a-z]{2})(?:-[a-z]{2})?\//i;

/**
 * Canonical URL helpers only.
 *
 * Legacy blind discovery / BFS crawling was intentionally removed.
 * Strong-mode ingest for official docs must start from the owner-controlled
 * seed manifest, not from autonomous sitemap discovery.
 */
export function canonicalizeDocsUrl(raw: string): string | null {
  try {
    const u = new URL(raw, DEFAULT_START_URL);
    if (u.hostname !== 'dev.wix.com') return null;

    // Remove fragment + query.
    u.hash = '';
    u.search = '';

    // Normalize trailing slash (keep /docs itself without trailing slash).
    if (u.pathname.endsWith('/') && u.pathname !== '/docs/') {
      u.pathname = u.pathname.slice(0, -1);
    }

    return u.toString();
  } catch {
    return null;
  }
}

export function isAllowedDocsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.hostname !== 'dev.wix.com') return false;
    if (!u.pathname.startsWith('/docs')) return false;

    const denyPrefixes = ['/docs/rest/', '/docs/sdk/', '/docs/api/', '/docs/reference/'];
    if (denyPrefixes.some((p) => u.pathname.startsWith(p))) return false;

    // If path looks like /docs/fr/... or /docs/es/... => localized.
    if (LANG_PREFIX_RE.test(u.pathname)) return false;

    // Filter out obvious assets.
    if (u.pathname.match(/\.(png|jpe?g|gif|svg|webp|css|js|map|pdf|zip)$/i)) return false;

    return true;
  } catch {
    return false;
  }
}

export function extractLinksFromHtml(html: string, baseUrl: string): string[] {
  const out: string[] = [];

  // Very small HTML link extractor: href="..." or href='...'
  const re = /href\s*=\s*(?:\"([^\"]+)\"|'([^']+)')/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = (m[1] ?? m[2] ?? '').trim();
    if (!href) continue;
    if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;

    const canon = canonicalizeDocsUrl(new URL(href, baseUrl).toString());
    if (!canon) continue;
    out.push(canon);
  }

  return out;
}
