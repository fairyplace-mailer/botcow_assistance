import type { ResponsesStateMode } from '../responses';

export function selectResponsesStateMode(params: {
  previousResponseId?: string;
}): ResponsesStateMode {
  if (params.previousResponseId) {
    return { kind: 'previous_response', previousResponseId: params.previousResponseId };
  }

  return { kind: 'stateless' };
}

export function payloadKeysForStateMode(stateMode: ResponsesStateMode): string[] {
  if (stateMode.kind === 'previous_response') return ['previous_response_id'];
  return [];
}
