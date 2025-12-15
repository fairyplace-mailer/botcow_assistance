# PWA

This app is a minimal Progressive Web App (PWA).

## What is implemented

- Manifest: `public/manifest.json`
- Service Worker registration: `src/app/SwRegister.tsx` (registers `/sw.js`)
- Service Worker: `public/sw.js`
  - caches stable static public assets (icons, manifest)
  - network-first navigation with offline fallback to cached `/`
- Offline chat history: last **20** chat messages are persisted in **IndexedDB**
  - storage: `src/app/pwa/chatStore.ts`
  - used by UI: `src/app/page.tsx`

## Notes

- Offline mode is best-effort.
- When offline, the UI blocks sending chat messages and shows a banner.
- We intentionally keep the SW cache list small and stable. Next.js build assets are hashed and can change frequently.

## Troubleshooting

- If you changed the service worker, you may need to hard reload or unregister the old SW in the browser DevTools.
