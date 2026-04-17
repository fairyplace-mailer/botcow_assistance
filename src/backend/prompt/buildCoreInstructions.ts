import type { ChatRoutingHints } from '../orchestrator/routingHints';
import type { ModelRoutingDecision } from '../modelRouter';
import type { AssistantExecutionContract } from '../orchestrator/contracts';
import {
  buildTouchedFilesBlock,
  CORE_POLICY_LINES,
  ORCHESTRATION_LINES,
  PRIORITY_OF_TRUTH_LINES,
  SELF_REWRITE_LINES,
} from './policyBlocks';
import { buildModelSpecificInstructions } from './modelSpecificInstructions';

type BuildCoreInstructionsParams = {
  routing: ModelRoutingDecision;
  hints?: ChatRoutingHints;
  execution: AssistantExecutionContract;
};

export function buildCoreInstructions({
  routing: _routing,
  hints,
  execution,
}: BuildCoreInstructionsParams): string {
  const touchedFiles = (hints?.touchedFiles ?? []).slice(0, 20);

  const modelSpecificLines = buildModelSpecificInstructions({
    model: execution.model,
    reasoningEffort: execution.reasoningEffort,
    toolUsePolicy: execution.toolUsePolicy,
  });

  return [
    ...CORE_POLICY_LINES,
    '',
    ...PRIORITY_OF_TRUTH_LINES,
    '',
    ...SELF_REWRITE_LINES,
    '',
    ...ORCHESTRATION_LINES,
    '',
    ...modelSpecificLines,
    '',
    ...buildTouchedFilesBlock(touchedFiles),
  ].join('\n');
}
