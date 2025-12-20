import fs from 'node:fs';
import path from 'node:path';

import { loadReposConfig, type ReposConfig } from '../config/repos';

export type RepoRegistrationArgs = {
  repo: string; // owner/name
  defaultBranch: string;
  vercel: {
    projectIdEnv: string;
    teamIdEnv?: string;
  };
};

const CONFIG_PATH = path.resolve(process.cwd(), 'config', 'repos.yml');

function assertNonEmpty(label: string, v: unknown): asserts v is string {
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function normalizeRepo(repo: string): string {
  const r = repo.trim();
  const parts = r.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('repo must be in the form "owner/name"');
  }
  return `${parts[0]}/${parts[1]}`;
}

// NOTE: We intentionally keep a tiny YAML writer for our controlled format.
function toYaml(cfg: ReposConfig): string {
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

export const repoRegistrationToolSchema = {
  type: 'function',
  function: {
    name: 'repo_register',
    description:
      'Owner-only: register or update a repository in config/repos.yml allowlist (including Vercel env mapping).',
    parameters: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'GitHub repository in the form owner/name.',
        },
        defaultBranch: {
          type: 'string',
          description: 'Default branch to use for this repository.',
        },
        vercel: {
          type: 'object',
          properties: {
            projectIdEnv: {
              type: 'string',
              description:
                'Name of env var containing Vercel projectId for this repo.',
            },
            teamIdEnv: {
              type: 'string',
              description:
                'Name of env var containing Vercel teamId for this repo (optional).',
            },
          },
          required: ['projectIdEnv'],
        },
      },
      required: ['repo', 'defaultBranch', 'vercel'],
    },
  },
} as const;

export async function repo_register(args: RepoRegistrationArgs) {
  const repo = normalizeRepo(args.repo);
  assertNonEmpty('defaultBranch', args.defaultBranch);
  assertNonEmpty('vercel.projectIdEnv', args.vercel?.projectIdEnv);
  if (args.vercel?.teamIdEnv !== undefined) {
    assertNonEmpty('vercel.teamIdEnv', args.vercel.teamIdEnv);
  }

  // Load config via existing parser (single source of truth)
  const cfg = loadReposConfig();

  const existingIdx = cfg.repos.findIndex((r) => r.repo === repo);
  const nextEntry = {
    repo,
    defaultBranch: args.defaultBranch.trim(),
    vercel: {
      projectIdEnv: args.vercel.projectIdEnv.trim(),
      ...(args.vercel.teamIdEnv ? { teamIdEnv: args.vercel.teamIdEnv.trim() } : {}),
    },
  };

  const nextCfg: ReposConfig = {
    ...cfg,
    repos:
      existingIdx >= 0
        ? cfg.repos.map((r, i) => (i === existingIdx ? nextEntry : r))
        : [...cfg.repos, nextEntry],
  };

  // Persist file
  fs.writeFileSync(CONFIG_PATH, toYaml(nextCfg), 'utf8');

  return {
    ok: true,
    action: existingIdx >= 0 ? 'updated' : 'added',
    repo,
  };
}
