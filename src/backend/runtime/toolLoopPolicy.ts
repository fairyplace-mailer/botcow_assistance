export function exceedsToolBudget(params: {
  totalToolCalls: number;
  requestedCalls: number;
  maxTotalToolCalls: number;
}): boolean {
  return params.totalToolCalls + params.requestedCalls > params.maxTotalToolCalls;
}

export function applyFingerprintGuard(params: {
  fingerprint: string;
  lastFingerprint: string | null;
  sameFingerprintInRow: number;
  maxSameFingerprintInRow: number;
}): {
  sameFingerprintInRow: number;
  repeated: boolean;
} {
  const nextSameFingerprintInRow =
    params.fingerprint === params.lastFingerprint ? params.sameFingerprintInRow + 1 : 1;

  return {
    sameFingerprintInRow: nextSameFingerprintInRow,
    repeated: nextSameFingerprintInRow >= params.maxSameFingerprintInRow,
  };
}

export function evaluateNoProgress(params: {
  progressThisRound: boolean;
  hasFinalText: boolean;
  roundFingerprints: string[];
  previousFingerprintBeforeRound: string | null;
  noProgressRounds: number;
  maxNoProgressRounds: number;
}): {
  fingerprintChanged: boolean;
  noProgressRounds: number;
  shouldAbort: boolean;
} {
  const roundFingerprint = params.roundFingerprints.length ? params.roundFingerprints.join('|') : null;
  const fingerprintChanged = roundFingerprint !== params.previousFingerprintBeforeRound;

  const nextNoProgressRounds =
    !params.progressThisRound && !params.hasFinalText && !fingerprintChanged
      ? params.noProgressRounds + 1
      : 0;

  return {
    fingerprintChanged,
    noProgressRounds: nextNoProgressRounds,
    shouldAbort: nextNoProgressRounds >= params.maxNoProgressRounds,
  };
}
