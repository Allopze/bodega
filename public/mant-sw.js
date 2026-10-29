/* Service worker de la app del mecánico (/m/mantencion).
 *
 * Qué hace:
 *  - Deja abrir la app sin señal: navegación network-first con respaldo al HTML
 *    que quedó guardado la última vez que cargó con sesión.
 *  - Guarda los archivos versionados de Next (`/_next/static/*`) para que la app
 *    arranque sin señal (cache-first, con tope).
 *  - Despierta a la app abierta cuando el sistema avisa que volvió la señal
 *    (Background Sync, donde exista).
 *
 * Qué NO hace, a propósito:
 *  - Jamás toca `/api/`, `_rsc` ni `/_next/data`: los datos viajan por la propia
 *    app con la credencial de dispositivo y nunca se guardan aquí.
 *  - No guarda redirecciones al login ni respuestas que no sean HTML 200: una
 *    página de login guardada como «la app» dejaría al mecánico sin poder abrirla.
 *
 * Alcance: `/m/mantencion` (ver components/mantencion/app/sw-register.tsx).
 */
const VERSION = "v1"
const CACHE_PREFIX = "mant-"
const SHELL_CACHE = `${CACHE_PREFIX}shell-${VERSION}`
const STATIC_CACHE = `${CACHE_PREFIX}static-${VERSION}`
const APP_PATH = "/m/mantencion"
const MAX_STATIC_ENTRIES = 160

/** Sólo una respuesta que de verdad es la app: 200, HTML y sin haber pasado por una redirección. */
function isCacheableShell(response) {
  return response.ok
    && !response.redirected
    && (response.headers.get("content-type") || "").includes("text/html")
}

async function storeShell() {
  try {
    const response = await fetch(APP_PATH, { credentials: "same-origin", cache: "no-store" })
    if (!isCacheableShell(response)) return false
    const cache = await caches.open(SHELL_CACHE)
    await cache.put(APP_PATH, response)
    return true
  } catch {
    return false
  }
}

async function trimStatic(cache) {
  const keys = await cache.keys()
  if (keys.length > MAX_STATIC_ENTRIES) {
    await Promise.all(keys.slice(0, keys.length - MAX_STATIC_ENTRIES).map((request) => cache.delete(request)))
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(storeShell())
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== SHELL_CACHE && key !== STATIC_CACHE)
      .map((key) => caches.delete(key)))
    await self.clients.claim()
  })())
})

function isNavigationToApp(request, url) {
  return request.mode === "navigate" && (url.pathname === APP_PATH || url.pathname.startsWith(`${APP_PATH}/`))
}

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/")
    || url.pathname === "/mant-manifest.json"
    || /^\/mant-icon-.*\.png$/.test(url.pathname)
}

async function appNavigation(request) {
  // Sólo la app misma se guarda como «la app»: su login (`/m/mantencion/entrar`)
  // también está en el alcance, y abrir sin señal debe mostrar la app, no el login.
  const isAppShell = new URL(request.url).pathname === APP_PATH
  try {
    const response = await fetch(request)
    if (isAppShell && isCacheableShell(response)) {
      const cache = await caches.open(SHELL_CACHE)
      await cache.put(APP_PATH, response.clone())
      return response
    }
    // El servidor respondió, pero caído (5xx): mejor la app guardada que la página de error.
    if (response.status >= 500) {
      const cached = await (await caches.open(SHELL_CACHE)).match(APP_PATH, { ignoreSearch: true })
      if (cached) return cached
    }
    return response
  } catch {
    const cached = await (await caches.open(SHELL_CACHE)).match(APP_PATH, { ignoreSearch: true })
    return cached || new Response("Sin conexión y la app todavía no se guardó en este teléfono. Ábrela una vez con señal.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    })
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) {
    await cache.put(request, response.clone())
    await trimStatic(cache)
  }
  return response
}

self.addEventListener("fetch", (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== "GET" || url.origin !== self.location.origin) return
  // Los datos jamás pasan por aquí.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/data/") || url.searchParams.has("_rsc")) return

  if (isNavigationToApp(request, url)) {
    event.respondWith(appNavigation(request))
    return
  }
  if (isStaticAsset(url)) event.respondWith(cacheFirst(request).catch(() => fetch(request)))
})

/* La app, ya abierta con señal, nos manda la lista de archivos que cargó: así el
 * primer arranque sin señal ya los tiene (el worker recién toma el control después
 * de esa primera carga y no los vio pasar). */
self.addEventListener("message", (event) => {
  const data = event.data
  if (!data || typeof data !== "object") return
  if (data.type === "precache" && Array.isArray(data.urls)) {
    event.waitUntil((async () => {
      const cache = await caches.open(STATIC_CACHE)
      for (const raw of data.urls.slice(0, MAX_STATIC_ENTRIES)) {
        try {
          const url = new URL(raw, self.location.origin)
          if (url.origin !== self.location.origin || !url.pathname.startsWith("/_next/static/")) continue
          if (await cache.match(url.pathname + url.search)) continue
          const response = await fetch(url.pathname + url.search)
          if (response.ok) await cache.put(url.pathname + url.search, response)
        } catch { /* sin señal: se guardará la próxima vez */ }
      }
      await trimStatic(cache)
      await storeShell()
    })())
  }
})

/* Background Sync: avisa a las ventanas abiertas para que sincronicen. La cola vive
 * en IndexedDB y la mueve la propia app con la credencial de cada autor. */
self.addEventListener("sync", (event) => {
  if (event.tag !== "mant-sync") return
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
    for (const client of clients) client.postMessage({ type: "mant-sync" })
  })())
})
