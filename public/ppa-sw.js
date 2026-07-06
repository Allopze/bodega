const CACHE_NAME = "ppa-v1"
const PPA_SCOPE = "/ppa"

const PRECACHE_URLS = [
  PPA_SCOPE,
  "/ppa-icon-192.png",
  "/ppa-icon-512.png",
]

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch(() => {
            // Silently skip precache failures — the page will
            // be cached on first successful visit instead.
          }),
        ),
      )
    }),
  )
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      ),
    ),
  )
  self.clients.claim()
})

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)
  const isPPAScope = url.pathname.startsWith(PPA_SCOPE)

  // Cache only PPA-scoped navigations and static assets
  // Server actions and API routes go straight to network
  if (!isPPAScope) return

  // Never cache POST requests (form submissions go to network)
  if (event.request.method !== "GET") return

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request).then((response) => {
        if (response.ok) {
          const cloned = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned))
        }
        return response
      })

      return cached || fetchPromise
    }),
  )
})
