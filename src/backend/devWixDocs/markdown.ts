import TurndownService from 'turndown';

export type HtmlToMarkdownResult = {
  title: string | null;
  markdown: string;
};

function extractTitle(html: string): string | null {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const rawTitle = titleMatch?.[1];
  const title = rawTitle ? rawTitle.replace(/\s+/g, ' ').trim() : null;
  return title && title.length ? title : null;
}

function pickPrimaryHtml(html: string): string {
  const mainMatch = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (mainMatch?.[0]) return mainMatch[0];

  const articleMatch = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch?.[0]) return articleMatch[0];

  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch?.[0]) return bodyMatch[0];

  return html;
}

export function normalizeMarkdownForHash(md: string): string {
  const normalized = md
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return normalized ? `${normalized}\n` : '';
}

export function htmlToMarkdown(html: string): HtmlToMarkdownResult {
  const title = extractTitle(html);
  const primaryHtml = pickPrimaryHtml(html);

  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    emDelimiter: '_',
  });

  turndown.remove(['script', 'style', 'noscript', 'svg']);

  const markdown = normalizeMarkdownForHash(turndown.turndown(primaryHtml));

  return { title, markdown };
}
