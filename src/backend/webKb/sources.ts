export type WebKbSource = {
  domain: string;
  startUrls: string[];
  allowedPathPrefixes: string[];
  denyPathSubstrings: string[];
};

export const WEB_KB_SOURCES: WebKbSource[] = [
  {
    domain: 'bagsoflove.com',
    startUrls: ['https://www.bagsoflove.com/'],
    allowedPathPrefixes: ['/'],
    denyPathSubstrings: [
      '/account',
      '/login',
      '/register',
      '/cart',
      '/checkout',
      '/search',
      '/wishlist',
      '/compare',
      '/my-',
    ],
  },
  {
    domain: 'spoonflower.com',
    // Keep scope curated: policies/help/about etc. Avoid UGC design catalogs.
    startUrls: [
      'https://www.spoonflower.com/en/help',
      'https://www.spoonflower.com/en/shipping',
      'https://www.spoonflower.com/en/returns',
      'https://www.spoonflower.com/en/terms-of-service',
      'https://www.spoonflower.com/en/privacy-notice',
      'https://www.spoonflower.com/en/accessibility',
      'https://www.spoonflower.com/en/how-it-works',
      'https://www.spoonflower.com/en/about',
    ],
    allowedPathPrefixes: [
      '/en/help',
      '/en/returns',
      '/en/shipping',
      '/en/terms-of-service',
      '/en/privacy-notice',
      '/en/accessibility',
      '/en/how-it-works',
      '/en/about',
    ],
    denyPathSubstrings: [
      '/design',
      '/designer',
      '/designers',
      '/designs',
      '/collection',
      '/collections',
      '/marketplace',
      '/shop',
      '/fabric',
      '/wallpaper',
      '/home-decor',
    ],
  },
];
