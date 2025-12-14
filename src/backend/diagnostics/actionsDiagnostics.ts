import { listWorkflowRuns } from '../github';

export type ActionsSetupDiagnosis = {
  repo?: string;
  ref?: string;
  workflow_id?: string;
  summary: string;
  hints: string[];
  checklistDoc: string;
  latestRunsFound?: number;
};

function isLikelyNotFoundError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes('404') || msg.toLowerCase().includes('not found');
}

function isLikelyForbiddenError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes('403') || msg.toLowerCase().includes('forbidden');
}

export async function githubDiagnoseActionsSetup(args: {
  repo?: string;
  ref?: string;
  workflow_id?: string;
}): Promise<ActionsSetupDiagnosis> {
  const checklistDoc = 'docs/ACTIONS_CHECKLIST.md';

  // We only do safe, low-cost API probes.
  try {
    const runs = await listWorkflowRuns({
      ...(args.repo ? { repo: args.repo } : {}),
      ...(args.ref ? { branch: args.ref } : {}),
      ...(args.workflow_id ? { workflow_id: args.workflow_id } : {}),
      per_page: 5,
    });

    const count = runs.runs.length;

    if (count === 0) {
      const base = {
        summary:
          'No workflow runs found for this repo/ref. Most likely: workflow trigger does not match your branch, Actions disabled, or workflow file not present on this branch.',
        hints: [
          'Open GitHub → Actions tab and check if the workflow appears and has any runs.',
          'Verify the workflow file `on:` section includes your branch (push/PR patterns).',
          'Verify the workflow file exists on the branch you pushed.',
          `Follow checklist: ${checklistDoc}`,
        ],
        checklistDoc,
        latestRunsFound: 0,
      } satisfies Omit<ActionsSetupDiagnosis, 'repo' | 'ref' | 'workflow_id'>;

      return {
        ...base,
        ...(args.repo ? { repo: args.repo } : {}),
        ...(args.ref ? { ref: args.ref } : {}),
        ...(args.workflow_id ? { workflow_id: args.workflow_id } : {}),
      };
    }

    // Runs exist -> Actions works. If user still complains, they probably need Stage 1 diagnostics (logs).
    const base = {
      summary:
        'Workflow runs exist. If CI “fails”, use workflow-run diagnostics to fetch the failing job and error lines.',
      hints: [
        'Use: github_diagnose_latest_workflow_run (or github_diagnose_workflow_run by run_id).',
        'If you see 403 in logs fetching, check workflow permissions (GITHUB_TOKEN) per checklist.',
        `Checklist: ${checklistDoc}`,
      ],
      checklistDoc,
      latestRunsFound: count,
    } satisfies Omit<ActionsSetupDiagnosis, 'repo' | 'ref' | 'workflow_id'>;

    return {
      ...base,
      ...(args.repo ? { repo: args.repo } : {}),
      ...(args.ref ? { ref: args.ref } : {}),
      ...(args.workflow_id ? { workflow_id: args.workflow_id } : {}),
    };
  } catch (e) {
    if (isLikelyForbiddenError(e)) {
      const base = {
        summary:
          'GitHub API returned 403 while trying to list workflow runs. This is usually Actions permissions / token permission issue.',
        hints: [
          'Check repository Settings → Actions → General → Workflow permissions (Read/Write).',
          'If this run is from a forked PR, secrets are not available by default.',
          `Follow checklist: ${checklistDoc}`,
        ],
        checklistDoc,
      } satisfies Omit<ActionsSetupDiagnosis, 'repo' | 'ref' | 'workflow_id' | 'latestRunsFound'>;

      return {
        ...base,
        ...(args.repo ? { repo: args.repo } : {}),
        ...(args.ref ? { ref: args.ref } : {}),
        ...(args.workflow_id ? { workflow_id: args.workflow_id } : {}),
      };
    }

    if (isLikelyNotFoundError(e)) {
      const base = {
        summary:
          'GitHub API returned 404 while trying to list workflow runs. This can mean: wrong repo name, Actions disabled, or no access.',
        hints: [
          'Verify repo full name (owner/name).',
          'Open GitHub UI and check Actions tab exists and is enabled.',
          `Follow checklist: ${checklistDoc}`,
        ],
        checklistDoc,
      } satisfies Omit<ActionsSetupDiagnosis, 'repo' | 'ref' | 'workflow_id' | 'latestRunsFound'>;

      return {
        ...base,
        ...(args.repo ? { repo: args.repo } : {}),
        ...(args.ref ? { ref: args.ref } : {}),
        ...(args.workflow_id ? { workflow_id: args.workflow_id } : {}),
      };
    }

    // Unknown error
    const msg = e instanceof Error ? e.message : String(e);
    const base = {
      summary: `Failed to probe Actions via API: ${msg}`,
      hints: [`Follow checklist: ${checklistDoc}`],
      checklistDoc,
    } satisfies Omit<ActionsSetupDiagnosis, 'repo' | 'ref' | 'workflow_id' | 'latestRunsFound'>;

    return {
      ...base,
      ...(args.repo ? { repo: args.repo } : {}),
      ...(args.ref ? { ref: args.ref } : {}),
      ...(args.workflow_id ? { workflow_id: args.workflow_id } : {}),
    };
  }
}
