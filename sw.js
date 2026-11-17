const PREFIX = "sc-field-guide:" + new URL(self.registration.scope).pathname + ":";
const CACHE = PREFIX + "7e5895118b34";
const FILES = ["./.nojekyll", "./app.mjs", "./core.mjs", "./guide.json", "./icon.svg", "./index.html", "./manifest.webmanifest", "./map.svg", "./style.css"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
  // Do not replace an active guide in the middle of a match.
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)))));
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    // Keep one coherent app/reference release, including on subsequent online visits.
    const saved = await cache.match(event.request, {ignoreSearch: true});
    if (saved) return saved;
    if (event.request.mode === "navigate" && url.pathname === new URL(self.registration.scope).pathname) {
      const index = await cache.match(new URL("index.html", self.registration.scope).href);
      if (index) return index;
    }
    return fetch(event.request);
  }));
});
