import crypto from "crypto";

export function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function stripTags(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tryExtractMain(html: string): string {
  const candidates = [
    /<main[\s\S]*?<\/main>/i,
    /<article[\s\S]*?<\/article>/i,
    /<div[^>]+id=["']content["'][\s\S]*?<\/div>/i,
  ];

  for (const re of candidates) {
    const m = html.match(re);
    if (m?.[0]) return m[0];
  }

  return html;
}

export function extractMainText(html: string): string {
  const main = tryExtractMain(html);
  const text = stripTags(main);
  return text;
}

export function classifyRefreshIntervalHours(url: string): number {
  const u = url.toLowerCase();
  const daily = [
    "shipping",
    "delivery",
    "returns",
    "refund",
    "policy",
    "privacy",
    "terms",
    "coupon",
    "discount",
    "wholesale",
    "pricing",
    "prices",
    "cost",
    "lead-time",
    "production",
  ];

  if (daily.some((k) => u.includes(k))) return 24;
  return 24 * 20; // 20 days
}
