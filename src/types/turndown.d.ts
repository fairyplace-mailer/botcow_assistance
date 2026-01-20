declare module 'turndown' {
  export type Options = {
    headingStyle?: 'setext' | 'atx';
    hr?: string;
    bulletListMarker?: '-' | '*' | '+';
    codeBlockStyle?: 'indented' | 'fenced';
    fence?: string;
    emDelimiter?: '_' | '*';
    strongDelimiter?: '**' | '__';
    linkStyle?: 'inlined' | 'referenced';
    linkReferenceStyle?: 'full' | 'collapsed' | 'shortcut';
  };

  export default class TurndownService {
    constructor(options?: Options);
    turndown(input: string): string;
    remove(selectors: string | string[]): void;
  }
}
