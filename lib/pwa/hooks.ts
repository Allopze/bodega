"use client"

/**
 * lib/pwa/hooks.ts
 *
 * React hooks for PPA offline support:
 *  - useOnlineStatus: tracks browser connectivity (en `use-online-status.ts`, reexportado)
 *  - usePpaOfflineQueue: manages IndexedDB queue, auto-syncs on reconnect
 */

import * as React from "react"
import {
  enqueuePpa,
  getPendingPpas,
  updatePpaStatus,
  deletePpa,
  countPendingPpas,
  countUnsentPpas,
  getUnsentPpas,
  getAllPpas,
  recoverStalePpas,
  requeueNetworkFailedPpas,
  purgeExpiredPpas,
  summarizePpaQueue,
  type QueuedPpa,
} from "./offline-queue"
import { getOrCreateDeviceId, sendHeartbeat } from "./heartbeat"
import { ppaSubmitSchema } from "@/lib/validation/ppa"
import { showSyncNotification } from "./notifications"
import { useOnlineStatus } from "./use-online-status"

/* ── useOnlineStatus ─────────────────────────────────────────────────────── */

// Vive en su propio módulo (ver `use-online-status.ts`); se reexporta aquí.
export { useOnlineStatus }

/* ── usePpaOfflineQueue ──────────────────────────────────────────────────── */

const MAX_SYNC_ATTEMPTS = 3

/** Dónde se guarda la faena del último envío (la lee el aviso de estado, ver `ppa-form.hooks.ts`). */
export const PPA_WORKSITE_KEY = "chome:pwa-worksite:ppa"

/**
 * Avisa a TI cómo está la cola de PPA de este teléfono. En segundo plano y sin
 * lanzar nunca: ver `heartbeat.ts`. `force` es sólo para la apertura de la app.
 */
export async function reportPpaHeartbeat(force: boolean): Promise<void> {
  try {
    const snapshot = summarizePpaQueue(await getAllPpas())
    let worksiteId: string | undefined
    try { worksiteId = localStorage.getItem(PPA_WORKSITE_KEY) || undefined } catch { /* sin faena */ }
    await sendHeartbeat("ppa", getOrCreateDeviceId("ppa"), snapshot, { worksiteId }, { force })
  } catch {
    // El aviso nunca puede romper la cola.
  }
}

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
      failureKind: "rejected",
      attempts: MAX_SYNC_ATTEMPTS,
      lastError: `Este registro no se puede enviar: ${detalle}`,
    })
    return { ok: false, message: `Este registro no se puede enviar: ${detalle}` }
  }

  await updatePpaStatus(item.id, {
    status: "syncing",
    attempts: item.attempts + 1,
    failureKind: undefined,
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
    await updatePpaStatus(item.id, { status: "failed", failureKind: "rejected", attempts: MAX_SYNC_ATTEMPTS, lastError: msg })
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
    const exhausted = item.attempts + 1 >= MAX_SYNC_ATTEMPTS
    await updatePpaStatus(item.id, {
      status: exhausted ? "failed" : "pending",
      // Agotar reintentos sin red NO es un rechazo: el envío está bien y sólo
      // falta conexión. Un error que no es de red tras tres intentos sí necesita
      // que alguien lo mire.
      ...(exhausted ? { failureKind: isNetworkError ? "network" as const : "rejected" as const } : {}),
      lastError: isNetworkError ? "Sin conexión" : msg,
    })
    return { ok: false, message: isNetworkError ? "Sin conexión" : msg }
  }
}

/**
 * Sincroniza lo pendiente y avisa a TI una sola vez al terminar. Devuelve lo que
 * sigue sin enviar (ver `getUnsentPpas`). Exportada para sus pruebas.
 */
export async function syncAllPending(): Promise<QueuedPpa[]> {
  // Sólo lo `pending`. Lo que se rindió por falta de red lo devuelve a la fila
  // `requeueNetworkFailedPpas`, que corre al abrir la app y al volver la señal (no
  // acá: en cada pasada haría un bucle cerrado cuando hay red pero el servidor no
  // responde). Un rechazo del servidor no se reintenta: necesita una persona.
  const pending = (await getPendingPpas())
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
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

  // Un solo aviso por pasada (no uno por ítem), con el estado ya asentado.
  void reportPpaHeartbeat(false)

  return getUnsentPpas()
}

export function usePpaOfflineQueue() {
  const online = useOnlineStatus()
  const [pendingCount, setPendingCount] = React.useState(0)
  const [syncing, setSyncing] = React.useState(false)
  // Sube cuando vuelve la señal: reinicia el temporizador del envío automático.
  const [reconnects, setReconnects] = React.useState(0)
  // Termina cuando lo rendido por red ya volvió a la fila; el envío automático lo espera.
  const requeued = React.useRef<Promise<unknown>>(Promise.resolve())

  // Lo que se cuenta (y se ofrece reintentar) es todo lo que no ha salido: pendientes,
  // en vuelo y lo que se rindió por falta de red. Contar sólo `pending` escondía el
  // aviso justo cuando la evaluación llevaba tres intentos sin llegar.
  const refreshCount = React.useCallback(async () => {
    const count = await countUnsentPpas()
    setPendingCount(count)
  }, [])

  // Al abrir: recuperar lo interrumpido, devolver a la fila lo que se rindió por red,
  // y contar.
  React.useEffect(() => {
    // Antes de contar: un ítem que quedó en "syncing" porque la app se cerró a
    // mitad de envío no aparece en ningún listado y nunca se reintenta.
    const ready = recoverStalePpas()
      .then(() => requeueNetworkFailedPpas())
      .catch(() => 0)
    requeued.current = ready
    ready.then(refreshCount).catch(() => {})
    // Un `synced` de más de 7 días se borra; un `failed` conserva su motivo para que
    // el usuario pueda verlo y rehacerlo: borrarlo automáticamente era perder en
    // silencio una evaluación de terreno. Pasados 30 días (`purgeExpiredPpas`) caen
    // también los sincronizados y los rechazados por el servidor, que ya no tienen
    // nada que enviar; lo que sigue sin salir (pendiente, en vuelo, sin red) NO caduca.
    getAllPpas().then((items) => {
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
      for (const item of items) {
        if (item.status === "synced" && new Date(item.createdAt).getTime() < cutoff) {
          deletePpa(item.id).catch(() => {})
        }
      }
    }).catch(() => {})
    purgeExpiredPpas().catch(() => {})
  }, [refreshCount])

  // Al volver la señal: lo que se rindió por red vuelve a la fila y el envío
  // automático parte de cero. `useOnlineStatus` sólo informa el estado.
  const retryCountRef = React.useRef(0)
  React.useEffect(() => {
    const onOnline = () => {
      const ready = requeueNetworkFailedPpas().catch(() => 0)
      requeued.current = ready
      ready.then(() => {
        retryCountRef.current = 0
        setReconnects((n) => n + 1)
        return refreshCount()
      }).catch(() => {})
    }
    window.addEventListener("online", onOnline)
    return () => window.removeEventListener("online", onOnline)
  }, [refreshCount])

  // P1-2: auto-sync with backoff on failure
  const MAX_AUTO_RETRIES = 5

  React.useEffect(() => {
    if (!online || syncing) return

    const trySync = async () => {
      await requeued.current
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
  }, [online, syncing, reconnects])

  /** Enqueue a PPA submission for offline storage. */
  const enqueue = React.useCallback(
    async (payload: Record<string, unknown>): Promise<QueuedPpa> => {
      const item = await enqueuePpa(payload)
      setPendingCount((c) => c + 1)
      return item
    },
    [],
  )

  /** Manually trigger sync of all unsent items (incl. the ones that gave up for lack of network). */
  const triggerSync = React.useCallback(async () => {
    if (!online || syncing) return []
    setSyncing(true)
    try {
      await requeueNetworkFailedPpas()
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
