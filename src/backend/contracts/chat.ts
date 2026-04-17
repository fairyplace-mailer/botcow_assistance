export type ChatRole = 'user';

export type ChatMessageContentPart = {
  text?: string;
  type?: string;
};

export type ChatMessageContent = string | ChatMessageContentPart[] | { text?: string };

export type ChatMessage = {
  role: ChatRole;
  content: ChatMessageContent;
};


export type ChatStateRef = {
  previousResponseId?: string;
};

export type ChatRequestBody = {
  messages: ChatMessage[];
  state?: ChatStateRef;
};

export type PublicResponsePhase = 'final_answer' | 'commentary' | 'unknown';

export type NormalizedChatResponse = {
  id: string | null;
  model: string | null;
  phase: PublicResponsePhase;
  outputText: string;
  reason: string;
  reasoningEffort: string | null;
  state: {
    previousResponseId: string | null;
  };
};

export type PublicChatSuccess = {
  ok: true;
  sessionId: string;
  response: NormalizedChatResponse;
  error: null;
};

export type PublicChatError = {
  ok: false;
  sessionId: string;
  response: null;
  error: {
    code: string;
    message: string;
  };
};

export type PublicChatResult = PublicChatSuccess | PublicChatError;
