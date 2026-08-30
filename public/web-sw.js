const BUILD_ID = "__EN_CROISSANT_BUILD_ID__";
const CACHE_PREFIX = "en-croissant-web-";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
const APP_BASE = new URL(self.registration.scope).pathname;
const APP_SHELL = [APP_BASE, `${APP_BASE}manifest.webmanifest`, `${APP_BASE}logo.png`];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true }))
      .then((clients) =>
        Promise.all(
          clients.map((client) =>
            client.postMessage({ type: "EN_CROISSANT_SW_ACTIVATED", buildId: BUILD_ID }),
          ),
        ),
      ),
  );
});

// Navigations and the hosted-library manifest must reflect fresh publishes on
// the first load, so they go network-first (cache is the offline fallback).
// Everything else (hashed app assets, hosted PGN/PDF payloads) stays
// cache-first; hosted file URLs carry a ?v= content stamp for freshness.
function isNetworkFirst(request, url) {
  if (request.mode === "navigate") return true;
  return url.pathname.endsWith("/web-library/manifest.json");
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Version probes must always reach the active immutable release. Caching
  // cache-busted probes would both hide updates and grow the cache forever.
  if (url.pathname.endsWith("/app-version.json")) {
    event.respondWith(fetch(request));
    return;
  }

  if (isNetworkFirst(request, url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          if (request.mode === "navigate") {
            const shell = await caches.match(APP_BASE);
            if (shell) return shell;
          }
          return Response.error();
        }),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          if (request.mode === "navigate") {
            return caches.match(APP_BASE);
          }
          return cached;
        });

      return cached ?? fetched;
    }),
  );
});
