/*
 * public/sw.js — Service Worker for PPA Digital offline support.
 *
 * Strategy:
 *  - Navigation requests: Network-first with offline fallback
 *  - Static assets (JS/CSS/fonts/images): Cache-first
 *  - API calls: Network-only (never cache server actions)
 *
 * The offline queue for PPA submissions is managed by IndexedDB in the app
 * layer (lib/pwa/offline-queue.ts), not here.
 */

const CACHE_NAME = "ppa-v3"
const SHELL_URLS = ["/ppa"]
const MAX_CACHE_ENTRIES = 60 // FIFO eviction cap to prevent unbounded growth

/* ── Install ──────────────────────────────────────────────────────────────── */

// P2-1: evict oldest entries when cache exceeds MAX_CACHE_ENTRIES (FIFO)
async function evictIfNecessary() {
  const cache = await caches.open(CACHE_NAME)
  const keys = await cache.keys()
  if (keys.length > MAX_CACHE_ENTRIES) {
    // Delete oldest entries (FIFO — first items in keys are oldest)
    const toDelete = keys.slice(0, keys.length - MAX_CACHE_ENTRIES)
    await Promise.all(toDelete.map((key) => cache.delete(key)))
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(SHELL_URLS).catch(() => {
        // Silently fail if precache fails (first visit may not have network).
        // The SW will still serve from cache after subsequent visits.
      }),
    ),
  )
  self.skipWaiting()
})

/* ── Activate ─────────────────────────────────────────────────────────────── */

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  )
  self.clients.claim()
})

/* ── Fetch ────────────────────────────────────────────────────────────────── */

self.addEventListener("fetch", (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET and cross-origin
  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return
  }

  // API routes: network only
  if (url.pathname.startsWith("/api/")) {
    return
  }

  // Static assets (JS/CSS/fonts/images): cache-first
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".woff2") ||
    url.pathname.endsWith(".woff") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".ico")
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone).then(() => evictIfNecessary()))
          }
          return response
        })
      }),
    )
    return
  }

  // PPA pages and navigation: network-first, fallback to cache
  if (url.pathname.startsWith("/ppa")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone).then(() => evictIfNecessary()))
          }
          return response
        })
        .catch(() =>
          caches.match(request).then((cached) => {
            if (cached) return cached
            // Return a basic offline page for navigation requests
            if (request.mode === "navigate") {
              return new Response(
                `<!DOCTYPE html>
<html lang="es-CL">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sin conexión — PPA Digital</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100dvh; margin: 0; background: #f5f5f5; color: #333; }
    .card { max-width: 400px; padding: 2rem; background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); text-align: center; }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
    p { font-size: 0.875rem; color: #666; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">📡</div>
    <h1>Sin conexión a internet</h1>
    <p>Tu PPA se guardará localmente y se enviará automáticamente cuando vuelva la conexión.</p>
  </div>
</body>
</html>`,
                {
                  headers: { "Content-Type": "text/html; charset=utf-8" },
                },
              )
            }
            return new Response("Offline", { status: 503 })
          }),
        ),
    )
    return
  }
})
