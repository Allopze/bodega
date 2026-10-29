"use client"

import { useCallback, useEffect, useRef } from "react"
import { listAccounts } from "@/lib/mantencion/client/accounts"
import { refreshCatalog, type RefreshOutcome } from "@/lib/mantencion/client/catalog-sync"
import { referencedPhotoIds } from "@/lib/mantencion/client/drafts"
import { collectOrphanPhotos } from "@/lib/mantencion/client/photo-store"
import { registerBackgroundSync, registerMantServiceWorker, requestPersistentStorage } from "@/lib/mantencion/client/pwa"
import { pruneSent, resetInterruptedSending } from "@/lib/mantencion/client/queue"
import { isOnline, startSignalTracking } from "@/lib/mantencion/client/signal"
import { startSyncLoop, type SyncLoop } from "@/lib/mantencion/client/sync-engine"

/** Cada cuánto se vuelve a pedir el catálogo mientras la app está abierta con señal. */
const CATALOG_REFRESH_MS = 10 * 60_000

/**
 * Todo lo que la app hace sola mientras está abierta: seguir la señal, registrar
 * el service worker, pedir almacenamiento persistente, ordenar la cola al abrir,
 * sincronizar y mantener el catálogo al día.
 */
export function useMantRuntime(activeUserId: string | null, ready: boolean) {
  const loop = useRef<SyncLoop | null>(null)

  useEffect(() => {
    if (!ready) return
    const stopSignal = startSignalTracking()
    void registerMantServiceWorker().then(() => { void requestPersistentStorage(); void registerBackgroundSync() })
    void (async () => {
      // Lo que quedó «enviando» porque se cerró la app a media subida vuelve a pendiente.
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
    const refresh = () => { if (isOnline()) void refreshCatalog(activeUserId) }
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

  const refresh = useCallback((): Promise<RefreshOutcome> => (activeUserId ? refreshCatalog(activeUserId) : Promise.resolve("skipped")), [activeUserId])

  return { syncNow, refresh }
}
