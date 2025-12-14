import {
  downloadWorkflowRunLogs,
  listWorkflowRunJobs,
  type WorkflowRunJob,
} from './github';
import {
  extractWorkflowRunLogsTextFromZipBase64,
  type WorkflowRunLogsText,
} from './githubLogs';

export type FailedStepSummary = {
  jobName: string;
  stepName: string;
  conclusion?: string | null;
};

export type CiFailureDiagnosis = {
  run_id: number;
  repo?: string;
  failedJobs: Array<{
    id: number;
    name: string;
    conclusion?: string | null;
    failedSteps: FailedStepSummary[];
  }>;
  logs?: {
    files: WorkflowRunLogsText['files'];
    textPreview: string;
  };
};

function isFailedConclusion(conclusion?: string | null) {
  return conclusion === 'failure' || conclusion === 'cancelled' || conclusion === 'timed_out';
}

function summarizeFailedSteps(job: WorkflowRunJob): FailedStepSummary[] {
  const steps = job.steps ?? [];
  return steps
    .filter((s) => isFailedConclusion(s.conclusion))
    .map((s) => ({
      jobName: job.name,
      stepName: s.name,
      conclusion: s.conclusion,
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
  return extractWorkflowRunLogsTextFromZipBase64(zip.contentBase64, {
    maxChars: args.maxChars,
  });
}

export async function diagnoseWorkflowRunFailure(args: {
  run_id: number;
  repo?: string;
  includeLogs?: boolean;
  maxLogChars?: number;
}): Promise<CiFailureDiagnosis> {
  const jobsResp = await listWorkflowRunJobs(
    args.repo ? { run_id: args.run_id, repo: args.repo } : { run_id: args.run_id },
  );

  const jobs = jobsResp.jobs ?? [];
  const failedJobs = jobs
    .filter((j) => isFailedConclusion(j.conclusion))
    .map((j) => ({
      id: j.id,
      name: j.name,
      conclusion: j.conclusion,
      failedSteps: summarizeFailedSteps(j),
    }));

  const diagnosis: CiFailureDiagnosis = {
    run_id: args.run_id,
    repo: args.repo,
    failedJobs,
  };

  if (args.includeLogs) {
    const logsText = await getWorkflowRunLogsText({
      run_id: args.run_id,
      repo: args.repo,
      maxChars: args.maxLogChars,
    });

    diagnosis.logs = {
      files: logsText.files,
      textPreview: logsText.text,
    };
  }

  return diagnosis;
}
