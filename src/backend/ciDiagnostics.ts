import {
  downloadWorkflowRunLogs,
  listWorkflowRunJobs,
  type NormalizedJob,
  listWorkflowRuns,
} from './github';
import {
  extractWorkflowRunLogsTextFromZipBase64,
  type WorkflowRunLogsText,
} from './githubLogs';

export type CiFailureDiagnosis = {
  runId: number;
  repo?: string;
  failedJobs: Array<{ id: number; name: string; html_url?: string }>;
  errorLines: string[];
  logFiles: Array<{ path: string; size: number }>;
};

function omitUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as any)[k] = v;
  }
  return out;
}

export async function githubGetWorkflowRunLogsText(args: {
  run_id: number;
  repo?: string;
  maxChars?: number;
}): Promise<WorkflowRunLogsText> {
  const zip = await downloadWorkflowRunLogs(
    args.repo ? { run_id: args.run_id, repo: args.repo } : { run_id: args.run_id },
  );

  const extractOpts = omitUndefined({ maxChars: args.maxChars });
  return extractWorkflowRunLogsTextFromZipBase64(zip.contentBase64, extractOpts);
}

function extractErrorLinesFromLogs(text: string, maxLines = 60): string[] {
  const lines = text.split(/\r?\n/);

  // Heuristics: common CI/build failure markers.
  const patterns = [
    /\bFailed to compile\b/i,
    /\bType error:\b/i,
    /\bError:\b/i,
    /Process completed with exit code\s+\d+/i,
    /Next\.js build worker exited with code/i,
    /ELIFECYCLE/i,
    /npm ERR!/i,
    /Command \".+\" exited with/i,
  ];

  const hits: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    if (patterns.some((p) => p.test(l))) hits.push(i);
  }

  if (hits.length === 0) return [];

  // Return a compact window around the first few hits.
  const windows: Array<[number, number]> = [];
  for (const idx of hits.slice(0, 4)) {
    windows.push([Math.max(0, idx - 3), Math.min(lines.length - 1, idx + 6)]);
  }

  // merge windows
  windows.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    if (!last || w[0] > last[1] + 1) merged.push([...w]);
    else last[1] = Math.max(last[1], w[1]);
  }

  const out: string[] = [];
  for (const [a, b] of merged) {
    for (let i = a; i <= b; i++) out.push(lines[i] ?? '');
    out.push('');
  }

  return out.filter((l) => l.trim().length > 0).slice(0, maxLines);
}

export async function githubDiagnoseWorkflowRun(args: {
  run_id: number;
  repo?: string;
  maxChars?: number;
}): Promise<CiFailureDiagnosis> {
  const jobs = await listWorkflowRunJobs(
    args.repo ? { run_id: args.run_id, repo: args.repo } : { run_id: args.run_id },
  );

  const failedJobs = jobs.jobs
    .filter((j: NormalizedJob) => j.conclusion === 'failure' || j.conclusion === 'cancelled')
    .flatMap((j: NormalizedJob) => {
      const base = { id: j.id, name: j.name };
      const url = j.html_url ?? undefined;
      return url ? [{ ...base, html_url: url }] : [base];
    });

  const logsText = await githubGetWorkflowRunLogsText({
    run_id: args.run_id,
    ...(args.repo ? { repo: args.repo } : {}),
    ...(args.maxChars !== undefined ? { maxChars: args.maxChars } : {}),
  });

  const errorLines = extractErrorLinesFromLogs(logsText.text);

  const baseResult = {
    runId: args.run_id,
    failedJobs,
    errorLines,
    logFiles: logsText.files,
  } satisfies Omit<CiFailureDiagnosis, 'repo'>;

  return args.repo ? { ...baseResult, repo: args.repo } : baseResult;
}

export async function githubDiagnoseLatestWorkflowRun(args: {
  repo?: string;
  workflow_id?: string;
  ref?: string;
  per_page?: number;
  maxChars?: number;
}): Promise<CiFailureDiagnosis> {
  const perPage = args.per_page ?? 10;

  const runsRes = await listWorkflowRuns({
    ...(args.repo ? { repo: args.repo } : {}),
    ...(args.workflow_id ? { workflow_id: args.workflow_id } : {}),
    ...(args.ref ? { branch: args.ref } : {}),
    per_page: perPage,
  });

  const first = runsRes.runs?.[0];
  if (!first) {
    throw new Error('No workflow runs found');
  }

  // IMPORTANT: run_id is always required; do NOT build it via Partial helpers.
  return githubDiagnoseWorkflowRun({
    run_id: first.id,
    ...(args.repo ? { repo: args.repo } : {}),
    ...(args.maxChars !== undefined ? { maxChars: args.maxChars } : {}),
  });
}
