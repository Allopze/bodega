import { getAccount } from "./accounts"
import { getHistory, getPhoto, type ApiFailure } from "./api"
import type { RefreshOutcome } from "./catalog-sync"
import { STORE, idbGet, idbPut, req, runTx } from "./db"
import { emit } from "./events"
import { reportReachable } from "./signal"
import type { CachedPhoto, DeviceAccount, StoredHistory } from "./types"

/**
 * Historial de mantenciones de toda la flota, para consultarlo sin señal. Va
 * por un canal propio (no engorda el catálogo) y con su `ETag`. Si el refresco
 * falla, la copia anterior se conserva intacta: un historial viejo sirve; uno
 * borrado por un mal día de señal, no.
 *
 * Las fotos se piden una a una y las ya vistas quedan en `photoCache`, con tope
 * de cantidad y de bytes (se expulsa la menos usada).
 */

/** Tope de la caché de fotos: lo primero que se alcance. */
export const PHOTO_CACHE_MAX_ITEMS = 80
export const PHOTO_CACHE_MAX_BYTES = 40 * 1024 * 1024

export async function loadStoredHistory(userId: string): Promise<StoredHistory | null> {
  return (await idbGet<StoredHistory>(STORE.history, userId)) ?? null
}

/** Estado del último refresco, en memoria: la interfaz lo lee junto con la copia guardada. */
export interface HistoryStatus { refreshing: boolean; failed: boolean }
const status = new Map<string, HistoryStatus>()

export function getHistoryStatus(userId: string): HistoryStatus {
  return status.get(userId) ?? { refreshing: false, failed: false }
}

export function resetHistoryStatusForTests(): void {
  status.clear()
  inFlight.clear()
}

function setStatus(userId: string, next: HistoryStatus): void {
  const current = getHistoryStatus(userId)
  if (current.refreshing === next.refreshing && current.failed === next.failed) return
  status.set(userId, next)
  emit("history")
}

const inFlight = new Map<string, Promise<RefreshOutcome>>()

function outcomeFrom(failure: ApiFailure): RefreshOutcome {
  if (failure.kind === "auth") return "needs_login"
  // `forbidden` (403) es un permiso que falta: entrar de nuevo no lo arregla, así que no se pide login.
  return failure.kind === "retry" && failure.network ? "offline" : "error"
}

async function refreshNow(userId: string, fetchImpl?: typeof fetch): Promise<RefreshOutcome> {
  const account = await getAccount(userId)
  if (!account || account.status !== "ok" || Date.parse(account.expiresAt) <= Date.now()) return "skipped"
  const stored = await loadStoredHistory(userId)

  const result = await getHistory(account.token, stored?.etag ?? null, fetchImpl)
  if (result.kind !== "ok") {
    if (result.kind === "retry") reportReachable(!result.network)
    // Un 401/403 aquí no marca la cuenta como vencida: eso lo decide el catálogo
    // (misma credencial). Así un permiso que falte sólo para el historial no frena los envíos.
    return outcomeFrom(result)
  }
  reportReachable(true)

  const fetchedAt = new Date().toISOString()
  if (result.value.notModified) {
    // 304 = la copia sigue al día: se anota la hora de la confirmación.
    if (!stored) return "unchanged"
    await idbPut(STORE.history, { ...stored, fetchedAt } satisfies StoredHistory)
    return "unchanged"
  }
  await idbPut(STORE.history, { userId, etag: result.value.etag, data: result.value.body, fetchedAt } satisfies StoredHistory)
  return "updated"
}

/** Refresca el historial de una cuenta. Una sola petición a la vez por cuenta; nunca lanza. */
export function refreshHistory(userId: string, options: { fetchImpl?: typeof fetch } = {}): Promise<RefreshOutcome> {
  const existing = inFlight.get(userId)
  if (existing) return existing
  setStatus(userId, { refreshing: true, failed: getHistoryStatus(userId).failed })
  const promise = refreshNow(userId, options.fetchImpl)
    .catch((): RefreshOutcome => "error")
    .then((outcome) => {
      // `skipped` (sin cuenta utilizable) no es una falla del historial.
      setStatus(userId, { refreshing: false, failed: outcome === "offline" || outcome === "error" || outcome === "needs_login" })
      if (outcome === "updated" || outcome === "unchanged") emit("history")
      return outcome
    })
    .finally(() => { inFlight.delete(userId) })
  inFlight.set(userId, promise)
  return promise
}

async function readCachedPhoto(photoId: string): Promise<Blob | null> {
  // Lectura y marca de uso en una sola transacción.
  return runTx([STORE.photoCache], "readwrite", async (s) => {
    const hit = (await req(s.photoCache.get(photoId))) as CachedPhoto | undefined
    if (!hit) return null
    await req(s.photoCache.put({ ...hit, lastUsedAt: Date.now() } satisfies CachedPhoto))
    return hit.blob
  })
}

/** Guarda la foto y expulsa las menos usadas hasta volver a los topes. Todo o nada. */
async function storePhoto(photoId: string, blob: Blob): Promise<void> {
  await runTx([STORE.photoCache], "readwrite", async (s) => {
    await req(s.photoCache.put({ photoId, blob, size: blob.size, lastUsedAt: Date.now() } satisfies CachedPhoto))
    const all = (await req(s.photoCache.getAll())) as CachedPhoto[]
    let count = all.length
    let bytes = all.reduce((sum, entry) => sum + entry.size, 0)
    // Más antigua primero; la recién guardada es la última en salir.
    const byAge = [...all].sort((a, b) => (a.photoId === photoId ? 1 : b.photoId === photoId ? -1 : a.lastUsedAt - b.lastUsedAt))
    for (const entry of byAge) {
      if (count <= PHOTO_CACHE_MAX_ITEMS && bytes <= PHOTO_CACHE_MAX_BYTES) break
      if (entry.photoId === photoId) break
      await req(s.photoCache.delete(entry.photoId))
      count -= 1
      bytes -= entry.size
    }
  })
}

/**
 * La imagen de una foto del historial: primero la copia del teléfono, después
 * la plataforma. `null` si no está guardada y no hay señal (o la descarga falla):
 * la pantalla lo muestra como «sin conexión», no como un error.
 */
export async function getPhotoBlob(account: Pick<DeviceAccount, "token">, photoId: string, fetchImpl?: typeof fetch): Promise<Blob | null> {
  try {
    const cached = await readCachedPhoto(photoId)
    if (cached) return cached
  } catch { /* sin almacenamiento legible: se intenta por red */ }
  // Sólo el navegador sin red evita el intento. Con `unreachable` de un corte anterior se
  // prueba igual: si la foto baja, `reportReachable(true)` limpia la señal de toda la app.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return null
  const result = await getPhoto(account.token, photoId, fetchImpl)
  if (result.kind === "retry") reportReachable(!result.network)
  if (result.kind !== "ok") return null
  reportReachable(true)
  try { await storePhoto(photoId, result.value) } catch { /* no hay espacio: se muestra igual, sin guardarla */ }
  return result.value
}
