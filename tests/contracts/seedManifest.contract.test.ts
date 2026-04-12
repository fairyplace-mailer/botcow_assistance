import { parseSeedManifestContent } from '../../src/backend/devWixDocs/seedManifest';

describe('seed manifest contract', () => {
  test('dedupes, canonicalizes and rejects out-of-scope URLs', () => {
    const parsed = parseSeedManifestContent(`
# comment
https://dev.wix.com/docs/sdk/
https://dev.wix.com/docs/sdk?x=1#frag
https://dev.wix.com/docs/reference/foo
https://example.com/docs/foo
`);

    expect(parsed.urls).toEqual(['https://dev.wix.com/docs/sdk']);
    expect(parsed.rejected).toEqual([
      { raw: 'https://dev.wix.com/docs/reference/foo', reason: 'out_of_scope' },
      { raw: 'https://example.com/docs/foo', reason: 'invalid' },
    ]);
  });
});
