import type { WorkflowRunLogsText } from './githubLogs';
import {
  downloadWorkflowRunLogs,
  listWorkflowRunJobs,
  listWorkflowRunsForRepo,
} from './github';
import { extractWorkflowRunLogsTextFromZipBase64 } from './githubLogs';

export type CiFailureSummary = {
  repo: string;
  runId: number;
  workflowId?: string;
  status?: string;
  conclusion?: string;
  htmlUrl?: string;

  /** Failed jobs (best-effort). */
  failedJobs: Array<{ id: number; name: string; conclusion?: string | null }>;

  /** Short human-readable failure reason (best-effort). */
  reason: string;

  /** Extracted evidence snippets (step errors / stack traces). */
  evidence: Array<{ file: string; snippet: string }>;

  /** Whether logs were truncated. */
  logsTruncated?: boolean;
};

function normalizeWhitespace(s: string) {
  return s.replace(/\r\n/g, '\n');
}

function pickBestErrorSnippets(text: string, limit: number) {
  const t = normalizeWhitespace(text);

  // Heuristics: common failure markers
  const markers: RegExp[] = [
    /\bFailed to compile\b[\s\S]{0,2000}/g,
    /\bError:\s[^\n]+[\s\S]{0,1500}/g,
    /\bERR!\b[^\n]*[\s\S]{0,1500}/g,
    /\bFAIL\b[^\n]*[\s\S]{0,1500}/g,
    /\bType error:\s[^\n]+[\s\S]{0,1500}/g,
  ];

  const snippets: string[] = [];
  for (const re of markers) {
    let m: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((m = re.exec(t)) && snippets.length < limit) {
      const raw = m[0];
      const cleaned = raw.split('\n').slice(0, 60).join('\n');
      snippets.push(cleaned);
    }
    if (snippets.length >= limit) break;
  }

  // Fallback: last ~80 lines
  if (snippets.length === 0) {
    const lines = t.split('\n');
    snippets.push(lines.slice(Math.max(0, lines.length - 80)).join('\n'));
  }

  return snippets.slice(0, limit);
}

export async function githubGetWorkflowRunLogsText(args: {
  run_id: number;
  repo?: string;
  maxChars?: number;
}): Promise<WorkflowRunLogsText> {
  const zip = await downloadWorkflowRunLogs({ run_id: args.run_id, repo: args.repo });
  return extractWorkflowRunLogsTextFromZipBase64(zip.contentBase64, {
    maxChars: args.maxChars,
  });
}

export async function githubDiagnoseWorkflowRun(args: {
  run_id: number;
  repo?: string;
  maxChars?: number;
  maxEvidence?: number;
}): Promise<CiFailureSummary> {
  const maxEvidence = args.maxEvidence ?? 6;

  const jobs = await listWorkflowRunJobs({ run_id: args.run_id, repo: args.repo });
  const failedJobs = (jobs.jobs ?? [])
    .filter((j: any) => j.conclusion === 'failure' || j.conclusion === 'cancelled')
    .map((j: any) => ({ id: j.id, name: j.name, conclusion: j.conclusion }));

  const logsText = await githubGetWorkflowRunLogsText({
    run_id: args.run_id,
    repo: args.repo,
    maxChars: args.maxChars ?? 250_000,
  });

  const snippets = pickBestErrorSnippets(logsText.text, maxEvidence);

  const evidence = snippets.map((s, idx) => ({
    file: `logs#${idx + 1}`,
    snippet: s,
  }));

  const reason = snippets[0]
    ? snippets[0].split('\n')[0].slice(0, 180)
    : 'CI failed (no error snippet found in logs).';

  return {
    repo: args.repo ?? '(default)',
    runId: args.run_id,
    failedJobs,
    reason,
    evidence,
    logsTruncated: logsText.truncated,
  };
}

export async function githubDiagnoseLatestWorkflowRun(args: {
  repo?: string;
  workflow_id?: string;
  ref?: string;
  per_page?: number;
  maxChars?: number;
  maxEvidence?: number;
}): Promise<CiFailureSummary> {
  const runs = await listWorkflowRunsForRepo({
    repo: args.repo,
    workflow_id: args.workflow_id,
    ref: args.ref,
    per_page: args.per_page ?? 20,
  });

  const run = (runs.workflow_runs ?? []).find(
    (r: any) => r.conclusion === 'failure' || r.conclusion === 'cancelled',
  );

  if (!run) {
    return {
      repo: args.repo ?? '(default)',
      runId: -1,
      workflowId: args.workflow_id,
      status: 'completed',
      conclusion: 'success',
      failedJobs: [],
      reason: 'No failed workflow runs found in the last runs.',
      evidence: [],
    };
  }

  const summary = await githubDiagnoseWorkflowRun({
    run_id: run.id,
    repo: args.repo,
    maxChars: args.maxChars,
    maxEvidence: args.maxEvidence,
  });

  return {
    ...summary,
    workflowId: args.workflow_id,
    status: run.status,
    conclusion: run.conclusion,
    htmlUrl: run.html_url,
  };
}
