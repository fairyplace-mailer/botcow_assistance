import type { ModelId, ReasoningEffort } from '../modelRouter';
import type { ToolUsePolicy } from '../orchestrator/contracts';

export function buildModelSpecificInstructions(params: {
  model: ModelId;
  reasoningEffort: ReasoningEffort;
  toolUsePolicy: ToolUsePolicy;
}): string[] {
  if (params.model === 'gpt-5.4') {
    return [
      'Prefer exact, evidence-backed changes over broad rewrites.',
      'For core, runtime, or architecture work, verify constraints before proposing edits.',
      ...(params.reasoningEffort === 'high' || params.reasoningEffort === 'xhigh'
        ? ['Be conservative and check edge cases before concluding.']
        : []),
      ...(params.toolUsePolicy === 'tool_first'
        ? ['Gather tool evidence before conclusions when the task depends on repo or infra facts.']
        : []),
    ];
  }

  if (params.model === 'gpt-5.4-mini') {
    return [
      'Prefer the smallest correct change.',
      'Avoid over-analysis and unnecessary expansion.',
      'Stay implementation-focused.',
      ...(params.toolUsePolicy === 'tool_first'
        ? ['Use tools before conclusions when the task depends on repo or infra facts.']
        : []),
    ];
  }

  return [
    'This is a narrow classification/extraction/ranking profile.',
    'Do not attempt architecture, deep debug, or risky rewrites.',
    'Do not speculate beyond directly supported input or tool evidence.',
  ];
}
