"use client"

import { useCallback, useEffect, useRef } from "react"
import { canSync, getAccount, getActiveAccountId, listAccounts } from "@/lib/mantencion/client/accounts"
import { refreshCatalog, type RefreshOutcome } from "@/lib/mantencion/client/catalog-sync"
import { refreshHistory } from "@/lib/mantencion/client/history-sync"
import { referencedPhotoIds } from "@/lib/mantencion/client/drafts"
import { collectOrphanPhotos } from "@/lib/mantencion/client/photo-store"
import { registerBackgroundSync, registerMantServiceWorker, requestPersistentStorage } from "@/lib/mantencion/client/pwa"
import { getDeviceId } from "@/lib/mantencion/client/meta"
import { listQueue, pruneSent, queueStats, resetInterruptedSending } from "@/lib/mantencion/client/queue"
import { isOnline, startSignalTracking } from "@/lib/mantencion/client/signal"
import { startSyncLoop, type SyncLoop } from "@/lib/mantencion/client/sync-engine"
import { sendHeartbeat, type QueueSnapshot } from "@/lib/pwa/heartbeat"

/** Cada cuánto se vuelve a pedir el catálogo (y el historial de la flota) mientras la app está abierta con señal. */
const CATALOG_REFRESH_MS = 10 * 60_000

/**
 * Avisa a TI cómo está la cola de este teléfono (todas las cuentas que lo usan).
 * Si hay una cuenta activa con credencial vigente, el aviso lleva su Bearer: así
 * el servidor sabe de quién es el teléfono sin que la app diga nada más. En
 * segundo plano y sin lanzar nunca; `force` es sólo para la apertura de la app.
 */
export async function reportMantHeartbeat(force: boolean): Promise<void> {
  try {
    const [items, deviceId, activeId] = await Promise.all([listQueue(), getDeviceId(), getActiveAccountId()])
    const now = Date.now()
    const stats = queueStats(items, undefined, now)
    let lastAttemptAt: string | null = null
    let lastError: { at: string; message: string } | null = null
    for (const item of items) {
      if (item.status === "sent") continue
      if (item.attempts > 0 && (lastAttemptAt === null || item.updatedAt > lastAttemptAt)) lastAttemptAt = item.updatedAt
      if (item.lastError && (lastError === null || item.updatedAt > lastError.at)) lastError = { at: item.updatedAt, message: item.lastError }
    }
    const snapshot: QueueSnapshot = {
      pending: stats.pending,
      failed: stats.rejected,
      oldestPendingAt: stats.oldestPendingMs === null ? null : new Date(now - stats.oldestPendingMs).toISOString(),
      lastAttemptAt,
      lastError: lastError?.message ?? null,
    }
    const account = activeId ? await getAccount(activeId) : null
    // La credencial es un secreto: sólo viaja en el encabezado, y sólo si sirve.
    const bearer = account && canSync(account, now) ? account.token : undefined
    await sendHeartbeat("mantencion", deviceId, snapshot, { bearer }, { force, now })
  } catch {
    // El aviso nunca puede romper la app.
  }
}

/**
 * Todo lo que la app hace sola mientras está abierta: seguir la señal, registrar
 * el service worker, pedir almacenamiento persistente, ordenar la cola al abrir,
 * sincronizar y mantener al día el catálogo y el historial de la flota.
 */
export function useMantRuntime(activeUserId: string | null, ready: boolean) {
  const loop = useRef<SyncLoop | null>(null)

  useEffect(() => {
    if (!ready) return
    const stopSignal = startSignalTracking()
    void registerMantServiceWorker().then(() => { void requestPersistentStorage(); void registerBackgroundSync() })
    void (async () => {
      // Lo que quedó «enviando» porque se cerró la app a media subida vuelve a pendiente
      // (el barrido toma el cerrojo `mant-sync`, el mismo del motor: ver `queue.ts`).
      await resetInterruptedSending()
      await pruneSent()
      // Aviso de apertura: al abrir se manda siempre, sin el freno de 5 min.
      void reportMantHeartbeat(true)
      const accounts = await listAccounts()
      await collectOrphanPhotos(await referencedPhotoIds(accounts.map((account) => account.userId)))
    })().catch(() => {})
    return stopSignal
  }, [ready])

  useEffect(() => {
    if (!ready) return
    // `startSyncLoop` no llama al callback cuando otra pestaña tenía el cerrojo
    // (`busy`); el resto de las pasadas avisa, con freno (ver `heartbeat.ts`).
    const sync = startSyncLoop(() => { void reportMantHeartbeat(false) })
    loop.current = sync
    return () => { sync.stop(); loop.current = null }
  }, [ready])

  useEffect(() => {
    if (!ready || !activeUserId) return
    // El historial va aparte: si falla (o tarda) no toca al catálogo, y al revés.
    // No se consulta `isOnline()`: esa señal pudo quedar pegada de un corte anterior y es
    // justamente el refresco el que la limpia (`reportReachable(true)` cuando la red responde).
    // Sólo se salta cuando el navegador mismo dice que no hay red.
    const refresh = () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return
      void refreshCatalog(activeUserId)
      void refreshHistory(activeUserId)
    }
    refresh()
    const onVisible = () => { if (document.visibilityState === "visible") refresh() }
    window.addEventListener("online", refresh)
    document.addEventListener("visibilitychange", onVisible)
    const timer = setInterval(refresh, CATALOG_REFRESH_MS)
    return () => { window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", onVisible); clearInterval(timer) }
  }, [ready, activeUserId])

  const syncNow = useCallback(() => {
    loop.current?.kick()
    // Sin señal, que el sistema despierte la app cuando vuelva (donde exista Background Sync).
    if (!isOnline()) void registerBackgroundSync()
  }, [])

  const refresh = useCallback((): Promise<RefreshOutcome> => {
    if (!activeUserId) return Promise.resolve("skipped")
    void refreshHistory(activeUserId)
    return refreshCatalog(activeUserId)
  }, [activeUserId])

  return { syncNow, refresh }
}
