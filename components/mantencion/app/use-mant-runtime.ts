"use client"

import { useCallback, useEffect, useRef } from "react"
import { listAccounts } from "@/lib/mantencion/client/accounts"
import { refreshCatalog, type RefreshOutcome } from "@/lib/mantencion/client/catalog-sync"
import { refreshHistory } from "@/lib/mantencion/client/history-sync"
import { referencedPhotoIds } from "@/lib/mantencion/client/drafts"
import { collectOrphanPhotos } from "@/lib/mantencion/client/photo-store"
import { registerBackgroundSync, registerMantServiceWorker, requestPersistentStorage } from "@/lib/mantencion/client/pwa"
import { pruneSent, resetInterruptedSending } from "@/lib/mantencion/client/queue"
import { isOnline, startSignalTracking } from "@/lib/mantencion/client/signal"
import { startSyncLoop, type SyncLoop } from "@/lib/mantencion/client/sync-engine"

/** Cada cuánto se vuelve a pedir el catálogo (y el historial de la flota) mientras la app está abierta con señal. */
const CATALOG_REFRESH_MS = 10 * 60_000

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
      const accounts = await listAccounts()
      await collectOrphanPhotos(await referencedPhotoIds(accounts.map((account) => account.userId)))
    })().catch(() => {})
    return stopSignal
  }, [ready])

  useEffect(() => {
    if (!ready) return
    const sync = startSyncLoop()
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
