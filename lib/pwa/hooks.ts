"use client"

/**
 * lib/pwa/hooks.ts
 *
 * React hooks for PPA offline support:
 *  - useOnlineStatus: tracks browser connectivity
 *  - usePpaOfflineQueue: manages IndexedDB queue, auto-syncs on reconnect
 */

import * as React from "react"
import {
  enqueuePpa,
  getPendingPpas,
  updatePpaStatus,
  deletePpa,
  countPendingPpas,
  getAllPpas,
  recoverStalePpas,
  type QueuedPpa,
} from "./offline-queue"
import { ppaSubmitSchema } from "@/lib/validation/ppa"
import { showSyncNotification } from "./notifications"

/* ── useOnlineStatus ─────────────────────────────────────────────────────── */

function subscribeOnlineStatus(onStoreChange: () => void) {
  window.addEventListener("online", onStoreChange)
  window.addEventListener("offline", onStoreChange)
  return () => {
    window.removeEventListener("online", onStoreChange)
    window.removeEventListener("offline", onStoreChange)
  }
}

function getOnlineSnapshot(): boolean {
  return navigator.onLine
}

/**
 * En el servidor no hay conectividad que medir. NO se puede preguntar por
 * `navigator`: desde Node 22 el runtime global expone un objeto `navigator` sin
 * `onLine`, así que un guard `typeof navigator !== "undefined"` daba por bueno
 * el entorno del servidor y leía `undefined` (falsy) — el servidor renderizaba
 * el aviso "Sin conexión" y el navegador, con `navigator.onLine === true`, el
 * formulario, dejando React #418 de hidratación en cada carga de /ppa.
 */
function getServerOnlineSnapshot(): boolean {
  return true
}

export function useOnlineStatus(): boolean {
  return React.useSyncExternalStore(subscribeOnlineStatus, getOnlineSnapshot, getServerOnlineSnapshot)
}

/* ── usePpaOfflineQueue ──────────────────────────────────────────────────── */

const MAX_SYNC_ATTEMPTS = 3

async function syncOne(item: QueuedPpa): Promise<{ ok: boolean; token?: string; message?: string }> {
  // Dynamic import to avoid bundling server actions in the SW context
  const { submitPpaAction } = await import(
    "@/app/(public)/ppa/actions"
  )

  // El almacenamiento local ES una frontera de confianza: lo que hay dentro lo
  // escribió otra versión del cliente (el Service Worker sirve JS cacheado). Un
  // payload con la forma antigua era rechazado por el servidor, gastaba los tres
  // reintentos y se borraba a los 7 días sin que nadie viera el motivo.
  const shape = ppaSubmitSchema.safeParse(item.payload)
  if (!shape.success) {
    const detalle = shape.error.issues.map((issue) => issue.message).join("; ")
    await updatePpaStatus(item.id, {
      status: "failed",
      attempts: MAX_SYNC_ATTEMPTS,
      lastError: `Este registro no se puede enviar: ${detalle}`,
    })
    return { ok: false, message: `Este registro no se puede enviar: ${detalle}` }
  }

  await updatePpaStatus(item.id, {
    status: "syncing",
    attempts: item.attempts + 1,
  })

  try {
    const res = await submitPpaAction(item.payload as Parameters<typeof submitPpaAction>[0])

    if (res.ok && res.data?.token) {
      await updatePpaStatus(item.id, {
        status: "synced",
        token: res.data.token,
      })
      return { ok: true, token: res.data.token }
    }

    // `ok: false` del servidor es un rechazo permanente (validación, alcance,
    // permiso): reintentarlo no lo arregla. Se marca `failed` de una vez, con el
    // motivo visible, en vez de agotar reintentos en silencio.
    const msg = res.message ?? "Error al sincronizar"
    await updatePpaStatus(item.id, { status: "failed", attempts: MAX_SYNC_ATTEMPTS, lastError: msg })
    return { ok: false, message: msg }
  } catch (e) {
    // P2-3: detect network errors more accurately — Safari sometimes
    // throws non-Error objects or DOMException without .message.
    const msg =
      e instanceof Error ? e.message :
      typeof e === "string" ? e :
      "Error de red"
    const isNetworkError = !navigator.onLine ||
      msg.includes("Failed to fetch") ||
      msg.includes("NetworkError") ||
      msg.includes("Network request failed") ||
      msg.includes("Load failed") // Safari
    await updatePpaStatus(item.id, {
      status: item.attempts + 1 >= MAX_SYNC_ATTEMPTS ? "failed" : "pending",
      lastError: isNetworkError ? "Sin conexión" : msg,
    })
    return { ok: false, message: isNetworkError ? "Sin conexión" : msg }
  }
}

async function syncAllPending(): Promise<QueuedPpa[]> {
  const pending = await getPendingPpas()
  let syncedCount = 0
  let lastToken: string | undefined

  for (const item of pending) {
    try {
      const result = await syncOne(item)
      if (result.ok && result.token) {
        syncedCount++
        lastToken = result.token
      }
    } catch {
      // P0-1: syncOne failure must not block remaining items.
      // syncOne already marks the item as failed/pending internally.
    }
  }

  // Single batched notification after all items synced
  if (syncedCount > 0) {
    // Link to last result for single sync, to main form for multiple
    const notificationUrl = syncedCount === 1 && lastToken
      ? `/ppa/result/${lastToken}`
      : "/ppa"
    showSyncNotification({
      title: syncedCount === 1
        ? "PPA enviado"
        : `${syncedCount} PPAs enviados`,
      body: syncedCount === 1
        ? "Tu evaluación offline se sincronizó correctamente."
        : `${syncedCount} evaluaciones offline se sincronizaron correctamente.`,
      url: notificationUrl,
    })
  }

  return getPendingPpas()
}

export function usePpaOfflineQueue() {
  const online = useOnlineStatus()
  const [pendingCount, setPendingCount] = React.useState(0)
  const [syncing, setSyncing] = React.useState(false)

  const refreshCount = React.useCallback(async () => {
    const count = await countPendingPpas()
    setPendingCount(count)
  }, [])

  // Refresh count on mount + cleanup old synced/failed items
  React.useEffect(() => {
    // Antes de contar: un ítem que quedó en "syncing" porque la app se cerró a
    // mitad de envío no aparece en ningún listado y nunca se reintenta.
    recoverStalePpas().then(refreshCount).catch(() => { refreshCount() })
    // Cleanup items synced or failed more than 7 days ago
    getAllPpas().then((items) => {
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
      for (const item of items) {
        // Sólo se borra lo ya sincronizado. Un `failed` conserva su motivo para
        // que el usuario pueda verlo y rehacerlo: borrarlo automáticamente era
        // perder en silencio una evaluación de terreno. La expiración por edad
        // de los no sincronizados vive en `purgeExpiredPpas` (30 días).
        if (item.status === "synced") {
          if (new Date(item.createdAt).getTime() < cutoff) {
            deletePpa(item.id).catch(() => {})
          }
        }
      }
    }).catch(() => {})
  }, [refreshCount])

  // P1-2: auto-sync with backoff on failure
  const retryCountRef = React.useRef(0)
  const MAX_AUTO_RETRIES = 5

  React.useEffect(() => {
    if (!online || syncing) return

    const trySync = async () => {
      const count = await countPendingPpas()
      if (count === 0) { retryCountRef.current = 0; return }

      setSyncing(true)
      try {
        const remaining = await syncAllPending()
        setPendingCount(remaining.length)
        if (remaining.length === 0) {
          retryCountRef.current = 0
        } else {
          // Exponential backoff: 1s, 2s, 4s, 8s, 16s
          retryCountRef.current = Math.min(retryCountRef.current + 1, MAX_AUTO_RETRIES)
        }
      } finally {
        setSyncing(false)
      }
    }

    const backoffMs = retryCountRef.current === 0 ? 1000 : Math.min(1000 * 2 ** retryCountRef.current, 16000)
    const timer = setTimeout(trySync, backoffMs)
    return () => clearTimeout(timer)
  }, [online, syncing])

  /** Enqueue a PPA submission for offline storage. */
  const enqueue = React.useCallback(
    async (payload: Record<string, unknown>): Promise<QueuedPpa> => {
      const item = await enqueuePpa(payload)
      setPendingCount((c) => c + 1)
      return item
    },
    [],
  )

  /** Manually trigger sync of all pending items. */
  const triggerSync = React.useCallback(async () => {
    if (!online || syncing) return []
    setSyncing(true)
    try {
      const remaining = await syncAllPending()
      setPendingCount(remaining.length)
      return remaining
    } finally {
      setSyncing(false)
    }
  }, [online, syncing])

  /** Clear all items — pending, synced, and failed (for debugging). */
  const clearAll = React.useCallback(async () => {
    const all = await getAllPpas()
    // P1-3: don't let one failure stop deletion of remaining items
    await Promise.allSettled(all.map((item) => deletePpa(item.id)))
    setPendingCount(0)
  }, [])

  return {
    online,
    pendingCount,
    syncing,
    enqueue,
    triggerSync,
    clearAll,
    refreshCount,
  }
}
