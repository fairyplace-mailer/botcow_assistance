import {
  downloadWorkflowRunLogs,
  listWorkflowRunJobs,
  type NormalizedJob,
} from './github';
import {
  extractWorkflowRunLogsTextFromZipBase64,
  type WorkflowRunLogsText,
} from './githubLogs';

export type DiagnoseWorkflowRunFailureResult = {
  run_id: number;
  repo?: string;
  failedJobs: Array<{
    id: number;
    name: string;
    conclusion: string | null;
    html_url?: string;
  }>;
  /** Short, human-readable explanation based on logs (best-effort). */
  reason: string;
  /** Raw extracted logs text (truncated). */
  logsText: WorkflowRunLogsText;
};

function summarizeFailedJobs(jobs: NormalizedJob[]) {
  return jobs
    .filter((j) => j.conclusion === 'failure' || j.conclusion === 'cancelled')
    .map((j) => ({
      id: j.id,
      name: j.name,
      conclusion: j.conclusion,
      html_url: j.html_url,
    }));
}

export async function getWorkflowRunLogsText(args: {
  run_id: number;
  repo?: string;
  maxChars?: number;
}): Promise<WorkflowRunLogsText> {
  const zip = await downloadWorkflowRunLogs(
    args.repo ? { run_id: args.run_id, repo: args.repo } : { run_id: args.run_id },
  );

  const extractOpts: { maxChars?: number } = {};
  if (typeof args.maxChars === 'number') extractOpts.maxChars = args.maxChars;

  return extractWorkflowRunLogsTextFromZipBase64(zip.contentBase64, extractOpts);
}

function pickReasonFromLogsText(text: WorkflowRunLogsText): string {
  // Best-effort: choose first matching common error lines from any file.
  // We intentionally keep it simple and deterministic.
  const patterns: RegExp[] = [
    /Failed to compile\./i,
    /Type error:/i,
    /error TS\d+:/i,
    /Error: Process completed with exit code \d+/i,
    /Command ".+" exited with \d+/i,
    /ELIFECYCLE/i,
  ];

  for (const file of text.files) {
    const content = text.contents[file.path] ?? '';
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (patterns.some((p) => p.test(trimmed))) return trimmed;
    }
  }

  return 'Could not automatically detect the exact failing line. Check extracted logs.';
}

export async function diagnoseWorkflowRunFailure(args: {
  run_id: number;
  repo?: string;
  maxChars?: number;
}): Promise<DiagnoseWorkflowRunFailureResult> {
  const jobs = await listWorkflowRunJobs(
    args.repo ? { run_id: args.run_id, repo: args.repo } : { run_id: args.run_id },
  );

  const logsText = await getWorkflowRunLogsText({
    run_id: args.run_id,
    repo: args.repo,
    maxChars: args.maxChars,
  });

  const reason = pickReasonFromLogsText(logsText);

  return {
    run_id: args.run_id,
    repo: args.repo,
    failedJobs: summarizeFailedJobs(jobs),
    reason,
    logsText,
  };
}
