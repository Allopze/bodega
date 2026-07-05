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
  type QueuedPpa,
} from "./offline-queue"
import { showSyncNotification } from "./notifications"

/* ── useOnlineStatus ─────────────────────────────────────────────────────── */

export function useOnlineStatus(): boolean {
  const [online, setOnline] = React.useState(
    () => typeof navigator !== "undefined" ? navigator.onLine : true,
  )

  React.useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [])

  return online
}

/* ── usePpaOfflineQueue ──────────────────────────────────────────────────── */

const MAX_SYNC_ATTEMPTS = 3

async function syncOne(item: QueuedPpa): Promise<{ ok: boolean; token?: string; message?: string }> {
  // Dynamic import to avoid bundling server actions in the SW context
  const { submitPpaAction } = await import(
    "@/app/(public)/ppa/actions"
  )

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

    const msg = res.message ?? "Error al sincronizar"
    await updatePpaStatus(item.id, {
      status: item.attempts + 1 >= MAX_SYNC_ATTEMPTS ? "failed" : "pending",
      lastError: msg,
    })
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
    showSyncNotification({
      title: syncedCount === 1
        ? "PPA enviado"
        : `${syncedCount} PPAs enviados`,
      body: syncedCount === 1
        ? "Tu evaluación offline se sincronizó correctamente."
        : `${syncedCount} evaluaciones offline se sincronizaron correctamente.`,
      url: lastToken ? `/ppa/result/${lastToken}` : "/ppa",
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
    refreshCount()
    // Cleanup items synced or failed more than 7 days ago
    getAllPpas().then((items) => {
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
      for (const item of items) {
        if (item.status === "synced" || (item.status === "failed" && item.attempts >= 3)) {
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
