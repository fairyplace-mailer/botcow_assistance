export type FetchHtmlResult =
  | { ok: true; status: number; url: string; finalUrl: string; html: string }
  | { ok: false; status?: number; url: string; finalUrl?: string; error: string };

const DEFAULT_TIMEOUT_MS = 12_000;

export async function fetchHtml(
  url: string,
  opts?: { timeoutMs?: number; userAgent?: string }
): Promise<FetchHtmlResult> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const userAgent = opts?.userAgent ?? "BotCowWebKB/1.0";

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": userAgent,
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      },
    });

    const finalUrl = res.url || url;
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return {
        ok: false,
        status: res.status,
        url,
        finalUrl,
        error: `non_html_content_type:${contentType}`,
      };
    }

    const html = await res.text();
    return { ok: true, status: res.status, url, finalUrl, html };
  } catch (e: any) {
    return { ok: false, url, error: e?.message ?? String(e) };
  } finally {
    clearTimeout(t);
  }
}
