import { logInfo, logWarn } from '../log';
import { DEV_WIX_SOURCE_KEY } from './seedManifest';

type Payload = Record<string, unknown>;

export function httpStatusClass(status: number | null | undefined): string | null {
  if (!Number.isFinite(status as number)) return null;
  const value = Number(status);
  if (value < 100) return null;
  return `${Math.floor(value / 100)}xx`;
}

export async function logDevWixInfo(event: string, payload: Payload) {
  return logInfo(event, {
    sourceKey: DEV_WIX_SOURCE_KEY,
    ...payload,
  });
}

export async function logDevWixWarn(event: string, payload: Payload) {
  return logWarn(event, {
    sourceKey: DEV_WIX_SOURCE_KEY,
    ...payload,
  });
}

export async function logDevWixDocumentStatusTransition(params: {
  jobId?: string | null;
  canonicalUrl: string;
  fromStatus: string | null | undefined;
  toStatus: string;
  lastHttpStatus?: number | null;
}) {
  return logDevWixInfo('dev_wix_document_status_transition', {
    jobId: params.jobId ?? null,
    canonicalUrl: params.canonicalUrl,
    documentStatusFrom: params.fromStatus ?? null,
    documentStatusTo: params.toStatus,
    lastHttpStatus: params.lastHttpStatus ?? null,
    httpStatusClass: httpStatusClass(params.lastHttpStatus ?? null),
  });
}
