"use client"

import * as React from "react"
import { CloudArrowUp, WifiSlash, QrCode, CircleNotch } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"
import {
  countPendingTaeSubmissions,
  countTaeQueue,
  clearTaeAccessConfig,
  clearTaeAccessToken,
  deleteTaeSubmission,
  getFailedTaeSubmissions,
  getPendingTaeSubmissions,
  getTaeAccessConfig,
  getTaeAccessToken,
  purgeSyncedTaeSubmissions,
  recoverStaleTaeSubmissions,
  registerTaeBackgroundSync,
  saveTaeAccessConfig,
  type QueuedTaeSubmission,
} from "@/lib/pwa/tae-offline-queue"
import { FieldLoadWizard, type ResumeRequest } from "@/components/combustibles/field-load/field-load-wizard"
import type { FieldLoadConfig, SubmitOutcome } from "@/components/combustibles/field-load/types"
import { TaeOutbox } from "./tae-outbox"
import { createPublicSubmitter, sendQueued, TaeSubmissionError } from "./tae-submitter"

/**
 * PWA pública de carga en terreno (enlace QR). Aquí vive lo propio del canal
 * público: el acceso guardado, la cola sin conexión y las cargas rechazadas; el
 * formulario por pasos es el mismo que usa el registro autenticado.
 */
export function TaeForm() {
  const [accessToken, setAccessToken] = React.useState<string | null>(null)
  const [config, setConfig] = React.useState<FieldLoadConfig | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [pendingCount, setPendingCount] = React.useState(0)
  const [failed, setFailed] = React.useState<QueuedTaeSubmission[]>([])
  const [online, setOnline] = React.useState(true)
  const [resume, setResume] = React.useState<ResumeRequest | null>(null)
  const resumeIdRef = React.useRef<string | null>(null)

  const refreshQueue = React.useCallback(async () => {
    try {
      // Las rechazadas no se van solas: se muestran aparte y no entran en
      // «pendiente(s)» (auditoría 2026-11-05, 5.3).
      const [cola, failedItems] = await Promise.all([countTaeQueue(), getFailedTaeSubmissions()])
      setPendingCount(cola.pending + cola.syncing)
      setFailed(failedItems)
    } catch { /* sin cola (navegador sin IndexedDB) */ }
  }, [])

  React.useEffect(() => {
    setOnline(navigator.onLine)
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    addEventListener("online", goOnline)
    addEventListener("offline", goOffline)
    return () => { removeEventListener("online", goOnline); removeEventListener("offline", goOffline) }
  }, [])

  React.useEffect(() => {
    void recoverStaleTaeSubmissions().then(refreshQueue)
    void purgeSyncedTaeSubmissions()
  }, [refreshQueue])

  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) return
    const refresh = () => { void refreshQueue() }
    navigator.serviceWorker.addEventListener("message", refresh)
    return () => navigator.serviceWorker.removeEventListener("message", refresh)
  }, [refreshQueue])

  React.useEffect(() => {
    const controller = new AbortController()
    let active = true
    void (async () => {
      const token = await getTaeAccessToken()
      if (!active) return
      if (!token) { setLoading(false); return }
      setAccessToken(token)
      let rejectedByServer = false
      try {
        const response = await fetch("/api/tae/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: token }), signal: controller.signal })
        if (!response.ok) {
          rejectedByServer = true
          throw new Error()
        }
        const body = await response.json() as { ok: boolean; data?: FieldLoadConfig }
        if (!body.ok || !body.data) {
          rejectedByServer = true
          throw new Error()
        }
        if (!active) return
        setConfig(body.data)
        await saveTaeAccessConfig(body.data as unknown as Record<string, unknown>)
      } catch {
        if (controller.signal.aborted) return
        if (rejectedByServer) {
          await Promise.all([clearTaeAccessToken(), clearTaeAccessConfig()])
          setAccessToken(null)
          setConfig(null)
          toast.error("El acceso TAE guardado fue revocado o ya no está disponible. Escanea un QR vigente.")
          return
        }
        const cached = await getTaeAccessConfig<FieldLoadConfig & Record<string, unknown>>()
        if (cached) {
          // Una configuración guardada por una versión anterior no trae medios de
          // suministro: se normaliza para que el formulario no falle al abrir.
          setConfig({ ...cached, supplyMedia: cached.supplyMedia ?? [] })
          toast.warning("Usando la última configuración guardada. Se validará al sincronizar.")
        } else {
          toast.error("No se pudo validar el enlace TAE. Conéctate e inténtalo nuevamente.")
        }
      } finally { if (active) setLoading(false) }
      if (!active) return
      await refreshQueue()
      if (await countPendingTaeSubmissions()) void registerTaeBackgroundSync()
    })()
    return () => { active = false; controller.abort() }
  }, [refreshQueue])

  const syncPending = React.useCallback(async () => {
    if (!accessToken || !navigator.onLine) return
    const pending = await getPendingTaeSubmissions()
    for (const item of pending) {
      try {
        await sendQueued({ ...item, accessToken: item.accessToken || accessToken })
      } catch (error) {
        if (!(error instanceof TaeSubmissionError) || error.retryable) break
      }
    }
    await refreshQueue()
    await purgeSyncedTaeSubmissions()
  }, [accessToken, refreshQueue])

  React.useEffect(() => { if (online) void syncPending() }, [online, syncPending])

  const submitter = React.useMemo(
    () => accessToken ? createPublicSubmitter(accessToken, refreshQueue) : null,
    [accessToken, refreshQueue],
  )
  const identityTransport = React.useMemo(
    () => accessToken ? { url: "/api/tae/identity", body: (rut: string) => ({ accessToken, rut }) } : null,
    [accessToken],
  )

  function fixFailed(item: QueuedTaeSubmission) {
    resumeIdRef.current = item.id
    setResume({ nonce: `${item.id}:${Date.now()}`, payload: item.payload, evidence: item.evidence, message: item.lastError ?? "La plataforma rechazó esta carga.", field: item.lastErrorField })
  }

  function handleOutcome(outcome: SubmitOutcome, resumed: boolean) {
    // La carga corregida ya salió (o quedó en cola): la rechazada original sobra.
    if (resumed && resumeIdRef.current && (outcome.kind === "sent" || outcome.kind === "queued")) {
      const id = resumeIdRef.current
      resumeIdRef.current = null
      void deleteTaeSubmission(id).then(refreshQueue)
    }
  }

  if (loading) return <main className="mx-auto flex min-h-dvh max-w-lg items-center justify-center px-4"><CircleNotch className="animate-spin text-[var(--color-primary)]" size={30} /></main>
  /*
   * Sin acceso configurado el formulario no se puede abrir, pero las cargas
   * rechazadas y sus fotos siguen en IndexedDB (auditoría 2026-11-05, 5.3). Antes
   * este `return` las ocultaba todas: la persona veía «Escanea el QR TAE» y
   * perdía la única pantalla desde la que podía corregirlas o descartarlas.
   * El outbox se muestra igual; sin acceso, corregir pide primero un QR vigente.
   */
  if (!config || !submitter) return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg items-center px-4">
      <div className="w-full">
        <div className="rounded-[var(--radius-2xl)] border border-(--color-border) bg-(--color-surface) p-6 text-center">
          <QrCode className="mx-auto text-[var(--color-primary)]" size={34} />
          <h1 className="mt-4 text-h2">Escanea el QR TAE</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">Este dispositivo aún no tiene un acceso TAE configurado.</p>
          {pendingCount > 0 && (
            <p role="status" className="mt-3 text-sm text-[var(--color-warning-ink)]">
              Quedan {pendingCount} {pendingCount === 1 ? "carga" : "cargas"} en este dispositivo. No se pierden: se envían solas al recuperar señal o al volver a abrir el formulario con un acceso vigente.
            </p>
          )}
        </div>
        <TaeOutbox
          failed={failed}
          onFix={() => toast.error("Escanea el QR TAE vigente para corregir y reenviar esta carga. Sus datos y fotos siguen guardados en este dispositivo.")}
          onDiscard={(id) => void deleteTaeSubmission(id).then(refreshQueue)}
        />
      </div>
    </main>
  )

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-6">
      <header className="mb-6 border-b border-(--color-rule) pb-4">
        <h1 className="text-xl font-semibold">Carga TAE</h1>
        <p className="mt-1 text-base text-[var(--color-text-muted)]">{config.worksite.name}{config.loadingPoint ? ` · ${config.loadingPoint.name}` : ""}</p>
        <p className="mt-3 flex items-center gap-1.5 text-sm text-[var(--color-text-muted)]" aria-live="polite">{online ? <CloudArrowUp size={16} /> : <WifiSlash size={16} />}{online ? "Conectado" : "Sin conexión"}{pendingCount > 0 ? ` · ${pendingCount} pendiente(s)` : ""}{failed.length > 0 ? ` · ${failed.length} rechazada(s)` : ""}</p>
      </header>

      <TaeOutbox failed={failed} onFix={fixFailed} onDiscard={(id) => void deleteTaeSubmission(id).then(refreshQueue)} />

      <FieldLoadWizard
        config={config}
        scopeKey={`${config.worksite.id}:${config.loadingPoint?.id ?? "none"}`}
        submit={submitter}
        identityTransport={identityTransport}
        resume={resume}
        onOutcome={handleOutcome}
      />
    </main>
  )
}
