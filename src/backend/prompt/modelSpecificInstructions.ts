import type { ModelId, ReasoningEffort } from '../modelRouter';
import type { ToolUsePolicy } from '../orchestrator/contracts';

export function buildModelSpecificInstructions(params: {
  model: ModelId;
  reasoningEffort: ReasoningEffort;
  toolUsePolicy: ToolUsePolicy;
  routingReason: string;
}): string[] {
  const common = [
    `Model profile: ${params.model}.`,
    `Assigned reasoning effort: ${params.reasoningEffort}.`,
    `Assigned routing reason: ${params.routingReason}.`,
  ];

  if (params.model === 'gpt-5.4') {
    return [
      ...common,
      'Use full-capability synthesis only when needed.',
      'Prefer exact evidence-backed changes over broad rewrites.',
      'For core/runtime or architecture work, verify constraints before proposing edits.',
      ...(params.reasoningEffort === 'high' || params.reasoningEffort === 'xhigh'
        ? ['This is a strong-mode task slice. Be conservative and evidence-first.']
        : []),
      ...(params.toolUsePolicy === 'tool_first'
        ? ['Tool evidence should be gathered before conclusions when the task depends on repo or infra facts.']
        : []),
    ];
  }

  if (params.model === 'gpt-5.4-mini') {
    return [
      ...common,
      'Prefer the smallest correct change.',
      'Avoid over-analysis and unnecessary expansion.',
      'Stay implementation-focused.',
      ...(params.toolUsePolicy === 'tool_first'
        ? ['Use tools before conclusions when the task depends on repo or infra facts.']
        : []),
    ];
  }

  return [
    ...common,
    'This is a narrow classification/extraction/ranking profile.',
    'Do not attempt architecture, deep debug, or risky rewrites.',
    'Do not speculate beyond directly supported input or tool evidence.',
  ];
}
