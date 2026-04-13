import type { ModelId, ReasoningEffort } from '../modelRouter';

export type ToolUsePolicy = 'minimal' | 'normal' | 'tool_first';

export type AssistantExecutionContract = {
  model: ModelId;
  reasoningEffort: ReasoningEffort;
  responseVerbosity: 'low' | 'medium' | 'high';
  maxOutputTokens: number;
  toolUsePolicy: ToolUsePolicy;
};

export type PlannedAssistantRunOptions = {
  model: ModelId;
  reasoning?: { effort: ReasoningEffort };
  text?: { verbosity?: 'low' | 'medium' | 'high' };
  maxOutputTokens?: number;
  reason?: string;
};
