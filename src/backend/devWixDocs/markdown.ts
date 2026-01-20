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

export function htmlToMarkdown(html: string): HtmlToMarkdownResult {
  const title = extractTitle(html);

  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    emDelimiter: '_',
  });

  // Remove noisy elements.
  turndown.remove(['script', 'style', 'noscript']);

  const markdown = turndown.turndown(html).replace(/\n{3,}/g, '\n\n').trim();

  return { title, markdown };
}
