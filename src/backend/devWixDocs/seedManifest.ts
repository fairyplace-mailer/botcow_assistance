import fs from 'fs';
import path from 'path';

import { canonicalizeDocsUrl, isAllowedDocsUrl } from './sitemapSeed';

export const DEV_WIX_SOURCE_KEY = 'wix_docs_public';
export const DEV_WIX_SOURCE_KIND = 'public_http_docs';
export const DEV_WIX_SCOPE_ALLOWLIST = 'https://dev.wix.com/docs/*';
export const DEV_WIX_SEED_MANIFEST_PATH = 'docs/rag/dev_wix.seed.txt';

export type SeedManifestLoadResult = {
  manifestPath: string;
  urls: string[];
  rejected: Array<{ raw: string; reason: 'empty' | 'invalid' | 'out_of_scope' }>;
};

export function parseSeedManifestContent(content: string): SeedManifestLoadResult {
  const seen = new Set<string>();
  const urls: string[] = [];
  const rejected: SeedManifestLoadResult['rejected'] = [];

  for (const line of content.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw || raw.startsWith('#')) continue;

    const canonical = canonicalizeDocsUrl(raw);
    if (!canonical) {
      rejected.push({ raw, reason: 'invalid' });
      continue;
    }

    if (!isAllowedDocsUrl(canonical)) {
      rejected.push({ raw, reason: 'out_of_scope' });
      continue;
    }

    if (seen.has(canonical)) continue;
    seen.add(canonical);
    urls.push(canonical);
  }

  return {
    manifestPath: DEV_WIX_SEED_MANIFEST_PATH,
    urls,
    rejected,
  };
}

export function loadDevWixSeedManifest(repoRoot = process.cwd()): SeedManifestLoadResult {
  const manifestPath = path.join(repoRoot, DEV_WIX_SEED_MANIFEST_PATH);
  const content = fs.readFileSync(manifestPath, 'utf8');
  const parsed = parseSeedManifestContent(content);
  return { ...parsed, manifestPath: DEV_WIX_SEED_MANIFEST_PATH };
}
