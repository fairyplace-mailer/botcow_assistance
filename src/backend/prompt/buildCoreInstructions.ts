import type { ChatRoutingHints } from '../contracts/chat';
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

export function buildCoreInstructions({ routing, hints, execution }: BuildCoreInstructionsParams): string {
  const touchedFiles = (hints?.touchedFiles ?? []).slice(0, 20);

  const executionFacts = [
    `Backend-owned model: ${execution.model}.`,
    `Backend-owned reasoning effort: ${execution.reasoningEffort}.`,
    `Backend-owned response verbosity: ${execution.responseVerbosity}.`,
    `Backend-owned max output tokens: ${execution.maxOutputTokens}.`,
    `Backend-owned tool-use policy: ${execution.toolUsePolicy}.`,
    `Current routing reason: ${routing.reason}.`,
  ];

  const modelSpecificLines = buildModelSpecificInstructions({
    model: execution.model,
    reasoningEffort: execution.reasoningEffort,
    toolUsePolicy: execution.toolUsePolicy,
    routingReason: routing.reason,
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
    ...executionFacts,
    '',
    ...buildTouchedFilesBlock(touchedFiles),
  ].join('\n');
}
