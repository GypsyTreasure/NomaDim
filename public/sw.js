/* NomaDim service worker (M8) — offline shell + cache-first kernel.
 *
 * Hand-rolled (no build-time precache manifest, no extra deps). Runtime
 * caching keyed off the registration scope so it works under any base path
 * (GitHub Pages serves the app under /<repo>/). Strategy:
 *   - navigations: network-first, fall back to the cached shell (offline).
 *   - OCCT WASM (.gzc/.wasm/.js) + hashed build assets: cache-first (immutable),
 *     so the ~14 MB kernel is downloaded once and every later visit is instant.
 *   - everything else same-origin: stale-while-revalidate.
 * Bump CACHE to invalidate everything on the next activation.
 */
const CACHE = 'nomadim-v1';
const scopeUrl = new URL(self.registration.scope);
const shellUrl = new URL('index.html', scopeUrl).toString();

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(scopeUrl.toString())));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isImmutableAsset(url) {
  return (
    /\.(gzc|wasm)$/.test(url.pathname) ||
    url.pathname.includes('/wasm/') ||
    url.pathname.includes('/assets/')
  );
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => hit);
  return hit ?? network;
}

async function navigationHandler(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(CACHE);
    return (
      (await cache.match(shellUrl)) ?? (await cache.match(scopeUrl.toString())) ?? Response.error()
    );
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== scopeUrl.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigationHandler(request));
  } else if (isImmutableAsset(url)) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(staleWhileRevalidate(request));
  }
});
