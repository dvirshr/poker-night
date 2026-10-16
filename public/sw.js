// Minimal service worker: makes the site installable as an app.
// It passes every request straight to the network and caches nothing,
// so an installed app never shows an old version.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode === 'navigate') e.respondWith(fetch(e.request));
});
