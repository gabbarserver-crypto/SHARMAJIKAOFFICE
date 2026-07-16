// Minimal service worker — its only job is to exist, since browsers require
// an active service worker before offering "Add to Home Screen" / install as
// a PWA. It doesn't cache anything (no offline support), it just passes
// every request straight through to the network.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  // Intentionally not intercepting — falls through to normal network fetch.
});
