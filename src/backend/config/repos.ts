import fs from 'node:fs';
import path from 'node:path';

export type RepoConfig = {
  repo: string; // owner/name
  defaultBranch?: string;
  vercel?: {
    projectIdEnv?: string;
    teamIdEnv?: string;
  };
};

export type ReposConfig = {
  version: number;
  defaultRepo: string;
  repos: RepoConfig[];
};

const CONFIG_PATH = path.resolve(process.cwd(), 'config', 'repos.yml');

function parseVerySimpleYaml(yaml: string): any {
  // Minimal YAML parser for our controlled format.
  // Supports: top-level scalars, nested objects via indentation, and arrays of objects under `repos:`.
  // This avoids introducing a yaml dependency.

  const lines = yaml
    .split(/\r?\n/)
    .map((l) => l.replace(/\t/g, '  '))
    .filter((l) => !l.trim().startsWith('#'));

  const root: any = {};
  const stack: Array<{ indent: number; obj: any; key?: string }> = [
    { indent: -1, obj: root },
  ];

  function current() {
    return stack[stack.length - 1]!.obj;
  }

  function setAtCurrent(key: string, value: any) {
    current()[key] = value;
  }

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;

    const indent = rawLine.match(/^ */)?.[0]?.length ?? 0;
    const line = rawLine.trimEnd();

    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) {
      stack.pop();
    }

    const trimmed = line.trim();

    // Array item
    if (trimmed.startsWith('- ')) {
      const rest = trimmed.slice(2);
      // Ensure parent is an array
      const parent = current();
      if (!Array.isArray(parent)) {
        // This happens when the previous key opened an array container
        // In our format, `repos:` opens an array.
        throw new Error('Invalid YAML structure: array item under non-array');
      }

      // Either inline key:value or start object
      const item: any = {};
      parent.push(item);

      if (rest.includes(':')) {
        const idx = rest.indexOf(':');
        const k = rest.slice(0, idx).trim();
        const vRaw = rest.slice(idx + 1).trim();
        item[k] = coerceScalar(vRaw);
      }

      stack.push({ indent, obj: item });
      continue;
    }

    // key: value OR key:
    const idx = trimmed.indexOf(':');
    if (idx === -1) continue;

    const key = trimmed.slice(0, idx).trim();
    const after = trimmed.slice(idx + 1).trim();

    if (after === '') {
      // open container (object or array depending on key)
      if (key === 'repos') {
        const arr: any[] = [];
        setAtCurrent(key, arr);
        stack.push({ indent, obj: arr, key });
      } else {
        const obj: any = {};
        setAtCurrent(key, obj);
        stack.push({ indent, obj, key });
      }
    } else {
      setAtCurrent(key, coerceScalar(after));
    }
  }

  return root;
}

function coerceScalar(v: string): any {
  if (v === 'null' || v === '~') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  // strip quotes if present
  const m = v.match(/^"(.*)"$/) || v.match(/^'(.*)'$/);
  if (m) return m[1];
  return v;
}

export function loadReposConfig(): ReposConfig {
  console.log('REPOS_DEBUG cwd=', process.cwd());
  console.log('REPOS_DEBUG configPath=', CONFIG_PATH);
  console.log('REPOS_DEBUG exists=', fs.existsSync(CONFIG_PATH));

  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Repos config not found: ${CONFIG_PATH}`);
  }

  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const parsed = parseVerySimpleYaml(raw);

  if (!parsed?.defaultRepo || !parsed?.repos || !Array.isArray(parsed.repos)) {
    throw new Error('Invalid repos config: expected defaultRepo and repos[]');
  }

  return parsed as ReposConfig;
}

export function getDefaultRepoFromConfig(): string {
  return loadReposConfig().defaultRepo;
}

export function isRepoAllowed(repo: string): boolean {
  const cfg = loadReposConfig();
  return cfg.repos.some((r) => r.repo === repo);
}

export function getRepoConfig(repo: string): RepoConfig | undefined {
  const cfg = loadReposConfig();
  return cfg.repos.find((r) => r.repo === repo);
}

function toYaml(cfg: ReposConfig): string {
  // Keep writer in the same style as config/repos.yml comments.
  const lines: string[] = [];
  lines.push('# BotCow multi-repo configuration');
  lines.push('#');
  lines.push('# This file is the source of truth for which repositories BotCow may operate on,');
  lines.push('# and how to map them to Vercel projects.');
  lines.push('#');
  lines.push('# Notes:');
  lines.push('# - repo: GitHub repository in the form "owner/name"');
  lines.push('# - defaultBranch: default branch used when not specified');
  lines.push('# - vercel:');
  lines.push('#   - projectId/teamId are Vercel identifiers (stored in env for the running app as needed)');
  lines.push('#   - if you don\'t use a team, teamId can be omitted or left empty');
  lines.push('');
  lines.push(`version: ${cfg.version}`);
  lines.push('');
  lines.push(`defaultRepo: ${cfg.defaultRepo}`);
  lines.push('');
  lines.push('repos:');

  for (const r of cfg.repos) {
    lines.push(`  - repo: ${r.repo}`);
    if (r.defaultBranch) {
      lines.push(`    defaultBranch: ${r.defaultBranch}`);
    }
    if (r.vercel) {
      lines.push('    vercel:');
      if (r.vercel.projectIdEnv) {
        lines.push(`      projectIdEnv: ${r.vercel.projectIdEnv}`);
      }
      if (r.vercel.teamIdEnv) {
        lines.push(`      teamIdEnv: ${r.vercel.teamIdEnv}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function upsertRepoConfig(next: RepoConfig): {
  ok: true;
  action: 'added' | 'updated';
  repo: string;
} {
  const cfg = loadReposConfig();

  const idx = cfg.repos.findIndex((r) => r.repo === next.repo);
  const nextCfg: ReposConfig = {
    ...cfg,
    repos: idx >= 0 ? cfg.repos.map((r, i) => (i === idx ? next : r)) : [...cfg.repos, next],
  };

  fs.writeFileSync(CONFIG_PATH, toYaml(nextCfg), 'utf8');

  return {
    ok: true,
    action: idx >= 0 ? 'updated' : 'added',
    repo: next.repo,
  };
}
