import type OpenAI from 'openai';

export type ToolPolicyMode = 'default' | 'repo_audit';

const READ_ONLY_TOOL_NAMES = new Set<string>([
  'github_get_repo_structure',
  'github_list_files',
  'github_get_file',
  'github_get_files_batch',
  'github_search_in_repo',
  'github_self_check_search_schema',
  'github_list_issues',
  'github_list_workflow_runs',
  'github_list_workflow_run_jobs',
  'github_download_workflow_run_logs',
  'github_get_workflow_run_logs_text',
  'github_diagnose_workflow_run',
  'github_diagnose_latest_workflow_run',
  'github_diagnose_actions_setup',
  'vercel_get_latest_deployments',
  'vercel_list_deployments',
  'vercel_get_runtime_logs',
  'vercel_search_runtime_logs',
  'vercel_get_deployment_status',
  'vercel_diagnose_deployment',
  'preview_get_url',
  'preview_http_request',
  'preview_smoke_check',
]);

export class ToolPolicyError extends Error {
  code = 'tool_not_allowed' as const;

  constructor(
    public readonly toolName: string,
    public readonly mode: ToolPolicyMode,
  ) {
    super(`Tool "${toolName}" is not allowed in mode "${mode}"`);
    this.name = 'ToolPolicyError';
  }
}

function getToolName(tool: OpenAI.Responses.Tool): string | null {
  const anyTool = tool as any;
  if (typeof anyTool?.name === 'string' && anyTool.name) return anyTool.name;
  if (typeof anyTool?.function?.name === 'string' && anyTool.function.name) {
    return anyTool.function.name;
  }
  return null;
}

export function isToolAllowed(name: string, mode: ToolPolicyMode): boolean {
  if (mode === 'default') return true;
  return READ_ONLY_TOOL_NAMES.has(name);
}

export function assertToolAllowed(name: string, mode: ToolPolicyMode): void {
  if (!isToolAllowed(name, mode)) {
    throw new ToolPolicyError(name, mode);
  }
}

export function filterToolsForMode<T extends OpenAI.Responses.Tool>(
  tools: T[],
  mode: ToolPolicyMode,
): T[] {
  if (mode === 'default') return tools;

  return tools.filter((tool) => {
    const name = getToolName(tool);
    return typeof name === 'string' && isToolAllowed(name, mode);
  });
}
