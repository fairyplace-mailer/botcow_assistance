export type ChatRoutingHints = {
  touchedFiles?: string[];
  previousAttemptFailed?: boolean;
  ragSourceCount?: number;
  hasSourceConflict?: boolean;
  toolHeavy?: boolean;
  multiFileIntent?: boolean;
  longContextSize?: number;
};
