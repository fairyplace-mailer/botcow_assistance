import AdmZip from 'adm-zip';

export type WorkflowRunLogsText = {
  files: Array<{ path: string; size: number }>;
  text: string;
  truncated: boolean;
};

function safeDecode(buf: Buffer) {
  // Most GH logs are UTF-8, but sometimes contain weird bytes.
  return buf.toString('utf8');
}

export function extractWorkflowRunLogsTextFromZipBase64(
  zipBase64: string,
  options?: {
    maxChars?: number;
    // Keep only files matching regex (e.g. ".*\\.txt$")
    includePath?: RegExp;
  },
): WorkflowRunLogsText {
  const maxChars = options?.maxChars ?? 200_000;
  const includePath = options?.includePath ?? /\.txt$/i;

  const zip = new AdmZip(Buffer.from(zipBase64, 'base64'));
  const entries = zip.getEntries();

  const files: Array<{ path: string; size: number }> = [];

  // GH Actions logs zip has files like: <job name>/<step name>.txt
  const textParts: string[] = [];
  let total = 0;
  let truncated = false;

  for (const e of entries) {
    if (e.isDirectory) continue;
    const path = e.entryName;
    if (!includePath.test(path)) continue;

    const data = e.getData();
    files.push({ path, size: data.length });

    const decoded = safeDecode(data);

    // Add header to separate files
    const chunk = `\n\n===== ${path} =====\n${decoded}`;

    if (total + chunk.length > maxChars) {
      const remaining = Math.max(0, maxChars - total);
      textParts.push(chunk.slice(0, remaining));
      truncated = true;
      break;
    }

    textParts.push(chunk);
    total += chunk.length;
  }

  return {
    files,
    text: textParts.join(''),
    truncated,
  };
}
