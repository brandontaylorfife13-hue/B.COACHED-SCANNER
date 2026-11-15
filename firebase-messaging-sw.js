// Temporary diagnostic service worker for B.COACHED.
// This intentionally contains no Firebase imports so Safari registration can be tested.
self.addEventListener("install", event => {
  self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});
