import type { ChatMessage, ChatRoutingHints } from '../contracts/chat';
import { chooseModel, type ModelRoutingDecision } from '../modelRouter';
import { buildCoreInstructions } from '../prompt/buildCoreInstructions';
import { normalizeContentToText } from '../prompt/normalizeContentToText';
import type { AssistantExecutionContract, PlannedAssistantRunOptions, ToolUsePolicy } from './contracts';

export type PlannedAssistantTurn = {
  normalizedHints: ChatRoutingHints;
  routing: ModelRoutingDecision;
  execution: AssistantExecutionContract;
  instructions: string;
  run: PlannedAssistantRunOptions;
};

function estimateMessagesTextLength(messages: ChatMessage[]): number {
  return (messages ?? []).reduce((sum, message) => {
    return sum + (normalizeContentToText(message?.content) ?? '').length;
  }, 0);
}

function normalizeHints(messages: ChatMessage[], hints: ChatRoutingHints = {}): ChatRoutingHints {
  const touchedFiles = hints.touchedFiles ?? [];
  const estimatedTextLength = estimateMessagesTextLength(messages);

  return {
    ...hints,
    touchedFiles,
    multiFileIntent: hints.multiFileIntent ?? touchedFiles.length > 1,
    longContextSize: hints.longContextSize ?? estimatedTextLength,
  };
}

function chooseToolUsePolicy(
  routing: ModelRoutingDecision,
  hints: ChatRoutingHints,
): ToolUsePolicy {
  if (
    hints.toolHeavy ||
    routing.reason === 'golden-core-self-rewrite' ||
    routing.reason === 'repo-audit-or-spec-compliance' ||
    routing.reason === 'source-conflict' ||
    routing.reason === 'deep-code-debug-review' ||
    routing.reason === 'architecture-or-design'
  ) {
    return 'tool_first';
  }

  if (routing.model === 'gpt-5.4-nano') return 'minimal';
  return 'normal';
}

function buildExecutionContract(
  routing: ModelRoutingDecision,
  hints: ChatRoutingHints,
): AssistantExecutionContract {
  const reasoningEffort = routing.reasoning?.effort ?? 'none';
  const toolUsePolicy = chooseToolUsePolicy(routing, hints);

  if (routing.model === 'gpt-5.4') {
    return {
      model: routing.model,
      reasoningEffort,
      responseVerbosity: 'medium',
      maxOutputTokens: 24000,
      toolUsePolicy,
    };
  }

  if (routing.model === 'gpt-5.4-mini') {
    return {
      model: routing.model,
      reasoningEffort,
      responseVerbosity: 'low',
      maxOutputTokens: 8000,
      toolUsePolicy,
    };
  }

  return {
    model: routing.model,
    reasoningEffort,
    responseVerbosity: 'low',
    maxOutputTokens: 4000,
    toolUsePolicy,
  };
}

export function planAssistantTurn(params: {
  messages: ChatMessage[];
  hints?: ChatRoutingHints;
}): PlannedAssistantTurn {
  const normalizedHints = normalizeHints(params.messages, params.hints ?? {});
  const routing = chooseModel(params.messages, normalizedHints);
  const execution = buildExecutionContract(routing, normalizedHints);
  const instructions = buildCoreInstructions({
    routing,
    hints: normalizedHints,
    execution,
  });

  const run: PlannedAssistantRunOptions = {
    model: execution.model,
    ...(execution.reasoningEffort !== 'none'
      ? { reasoning: { effort: execution.reasoningEffort } }
      : {}),
    reason: routing.reason,
    text: { verbosity: execution.responseVerbosity },
    maxOutputTokens: execution.maxOutputTokens,
  };

  return {
    normalizedHints,
    routing,
    execution,
    instructions,
    run,
  };
}
