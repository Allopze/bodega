/* RE-20 worker, scoped to /prevencion/incidentes/ (see components/pwa/re20-pwa-register.tsx). It caches only a content-free offline shell (no user data) and
 * immutable Next static assets; authenticated HTML, RSC payloads and APIs stay
 * network-only. Its cache namespace is isolated from the PPA worker. */
const CACHE_NAME = "chome-re20-shell-v1"
const CACHE_PREFIX = "chome-re20-shell-"
const OFFLINE_PATH = "/prevencion/incidentes/re20-offline"
const MAX_STATIC_ASSETS = 100

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_PATH).catch(() => {})))
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys
    .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
    .map((key) => caches.delete(key)))))
  self.clients.claim()
})

async function trimStaticCache(cache) {
  const requests = await cache.keys()
  const assets = requests.filter((request) => new URL(request.url).pathname.startsWith("/_next/static/"))
  if (assets.length > MAX_STATIC_ASSETS) {
    await Promise.all(assets.slice(0, assets.length - MAX_STATIC_ASSETS).map((request) => cache.delete(request)))
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== "GET" || url.origin !== self.location.origin) return
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/data/") || url.searchParams.has("_rsc")) return

  if (url.pathname === OFFLINE_PATH) {
    event.respondWith(fetch(request).then(async (response) => {
      if (response.ok && (response.headers.get("content-type") || "").includes("text/html")) {
        const cache = await caches.open(CACHE_NAME)
        await cache.put(OFFLINE_PATH, response.clone())
      }
      return response
    }).catch(async () => (await caches.open(CACHE_NAME)).match(OFFLINE_PATH)))
    return
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request)
      if (cached) return cached
      const response = await fetch(request)
      if (response.ok) {
        await cache.put(request, response.clone())
        await trimStaticCache(cache)
      }
      return response
    }))
  }
})
