const CACHE_NAME = "tae-v2"
const SHELL_URLS = [
  "/tae",
  "/tae-manifest.json",
  "/tae-icon-192.png",
  "/tae-icon-512.png",
  "/tae-icon-maskable-512.png",
]
const DB_NAME = "tae-offline"
const DB_VERSION = 2
const SUBMISSIONS = "submissions"

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS).catch(() => {})))
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("tae-") && key !== CACHE_NAME).map((key) => caches.delete(key)))))
  self.clients.claim()
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== "GET" || url.origin !== self.location.origin) return

  const isStaticAsset = url.pathname.startsWith("/_next/static/") || /\.(?:js|css|woff2?|png|svg|ico)$/.test(url.pathname)
  if (isStaticAsset) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) void caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()))
      return response
    })))
    return
  }

  const isTaeNavigation = request.mode === "navigate" && url.pathname.startsWith("/tae")
  if (!isTaeNavigation) return
  event.respondWith(fetch(request).then((response) => {
    if (response.ok && url.pathname === "/tae") void caches.open(CACHE_NAME).then((cache) => cache.put("/tae", response.clone()))
    return response
  }).catch(() => caches.match(request).then((cached) => cached || caches.match("/tae").then((shell) => shell || new Response("Sin conexión", { status: 503 })))))
})

self.addEventListener("sync", (event) => {
  if (event.tag === "tae-sync") event.waitUntil(syncPendingSubmissions())
})

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SUBMISSIONS)) {
        const store = db.createObjectStore(SUBMISSIONS, { keyPath: "id" })
        store.createIndex("status", "status", { unique: false })
        store.createIndex("createdAt", "createdAt", { unique: false })
      }
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings")
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function updateSubmission(db, id, patch) {
  const tx = db.transaction(SUBMISSIONS, "readwrite")
  const store = tx.objectStore(SUBMISSIONS)
  const current = await requestValue(store.get(id))
  if (!current) return
  await requestValue(store.put({ ...current, ...patch, updatedAt: new Date().toISOString() }))
}

async function syncPendingSubmissions() {
  const db = await openDb()
  const tx = db.transaction(SUBMISSIONS, "readonly")
  const pending = await requestValue(tx.objectStore(SUBMISSIONS).index("status").getAll("pending"))
  pending.sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  for (const item of pending) {
    await updateSubmission(db, item.id, { status: "syncing", attempts: (item.attempts ?? 0) + 1 })
    const form = new FormData()
    form.set("accessToken", item.accessToken)
    form.set("payload", JSON.stringify(item.payload))
    for (const evidence of item.evidence) form.set(evidence.kind, evidence.blob, evidence.fileName)

    try {
      const response = await fetch("/api/tae/submit", { method: "POST", body: form })
      const body = await response.json()
      if (response.ok && body.ok && body.data?.publicResultToken) {
        await updateSubmission(db, item.id, { status: "synced", publicResultToken: body.data.publicResultToken, syncedAt: new Date().toISOString(), lastError: undefined })
        continue
      }
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500
      await updateSubmission(db, item.id, { status: retryable ? "pending" : "failed", lastError: body.message || "La plataforma rechazó la carga" })
      if (retryable) throw new Error(body.message || "Reintento pendiente")
    } catch (error) {
      const latestTx = db.transaction(SUBMISSIONS, "readonly")
      const latest = await requestValue(latestTx.objectStore(SUBMISSIONS).get(item.id))
      if (latest?.status !== "failed") await updateSubmission(db, item.id, { status: "pending", lastError: error instanceof Error ? error.message : "Sin conexión" })
      throw error
    }
  }

  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
  for (const client of clients) client.postMessage({ type: "tae-sync-complete" })
}
