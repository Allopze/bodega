"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { Camera, CloudArrowUp, WifiSlash, QrCode, CircleNotch } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/lib/toast"
import {
  countPendingTaeSubmissions,
  clearTaeAccessConfig,
  clearTaeAccessToken,
  deleteTaeSubmission,
  enqueueTaeSubmission,
  getFailedTaeSubmissions,
  getPendingTaeSubmissions,
  getTaeAccessConfig,
  getTaeAccessToken,
  purgeSyncedTaeSubmissions,
  recoverStaleTaeSubmissions,
  registerTaeBackgroundSync,
  saveTaeAccessConfig,
  updateTaeSubmission,
  type QueuedTaeEvidence,
} from "@/lib/pwa/tae-offline-queue"
import type { TaeEvidenceKind } from "@/lib/services/fuel-tae"
import { compressPhoto } from "@/lib/pwa/image-compress"
import { useTaeIdentity } from "./use-tae-identity"

type AccessConfig = {
  worksite: { id: string; name: string }
  loadingPoint: { id: string; name: string } | null
  vehicles: Array<{ id: string; code: string | null; plate: string; type: string }>
}

class TaeSubmissionError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message)
    this.name = "TaeSubmissionError"
  }
}

const EVIDENCE: Array<{ kind: TaeEvidenceKind; label: string }> = [
  { kind: "odometer", label: "Foto de odómetro u horómetro" },
  { kind: "liter_meter", label: "Foto de medidor de litros" },
  { kind: "removed_seal", label: "Foto de sello retirado" },
  { kind: "installed_seal", label: "Foto de sello instalado" },
]

function newClientId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `tae-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isQuotaExceeded(error: unknown) {
  return error instanceof DOMException && error.name === "QuotaExceededError"
}

function EvidenceInput({ kind, label, file, compressing, onSelect }: { kind: TaeEvidenceKind; label: string; file?: File; compressing: boolean; onSelect: (file?: File) => void }) {
  const [preview, setPreview] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!file) { setPreview(null); return }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  return <label htmlFor={`tae-evidence-${kind}`} className="relative flex min-h-32 cursor-pointer flex-col justify-end overflow-hidden rounded-[var(--radius)] border border-dashed border-(--color-border-strong) bg-(--color-surface-2) text-center text-sm">
    {preview ? <Image unoptimized src={preview} alt={`Vista previa: ${label}`} width={480} height={320} className="absolute inset-0 h-full w-full object-cover" /> : <Camera className="mx-auto mb-8 text-[var(--color-text-muted)]" size={22} />}
    <span className={preview ? "relative mt-auto bg-black/65 px-3 py-2 text-white" : "px-3 pb-4"}>{compressing ? "Optimizando foto…" : file ? "Repetir foto" : label}</span>
    <input id={`tae-evidence-${kind}`} className="sr-only" type="file" accept="image/jpeg,image/png" capture="environment" onChange={(event) => onSelect(event.target.files?.[0])} />
  </label>
}

async function sendQueued(item: { id: string; accessToken: string; payload: Record<string, unknown>; evidence: QueuedTaeEvidence[]; attempts: number }) {
  await updateTaeSubmission(item.id, { status: "syncing", attempts: item.attempts + 1 })
  const form = new FormData()
  form.set("accessToken", item.accessToken)
  form.set("payload", JSON.stringify(item.payload))
  for (const evidence of item.evidence) form.set(evidence.kind, new File([evidence.blob], evidence.fileName, { type: evidence.blob.type }))
  try {
    const response = await fetch("/api/tae/submit", { method: "POST", body: form })
    const body = await response.json() as { ok: boolean; message?: string; data?: { publicResultToken: string } }
    if (!response.ok || !body.ok || !body.data?.publicResultToken) {
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500
      const message = body.message ?? "No se pudo sincronizar"
      await updateTaeSubmission(item.id, { status: retryable ? "pending" : "failed", lastError: message })
      throw new TaeSubmissionError(message, retryable)
    }
    await updateTaeSubmission(item.id, { status: "synced", publicResultToken: body.data.publicResultToken, syncedAt: new Date().toISOString() })
    return body.data.publicResultToken
  } catch (error) {
    if (error instanceof TaeSubmissionError) throw error
    await updateTaeSubmission(item.id, { status: "pending", lastError: error instanceof Error ? error.message : "Sin conexión" })
    throw error
  }
}

export function TaeForm() {
  const router = useRouter()
  const [accessToken, setAccessToken] = React.useState<string | null>(null)
  const [config, setConfig] = React.useState<AccessConfig | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [pendingCount, setPendingCount] = React.useState(0)
  const [failed, setFailed] = React.useState<Awaited<ReturnType<typeof getFailedTaeSubmissions>>>([])
  const [submitting, setSubmitting] = React.useState(false)
  const [online, setOnline] = React.useState(true)
  const [vehicleId, setVehicleId] = React.useState("")
  const [meterType, setMeterType] = React.useState<"odometer" | "hour_meter">("odometer")
  const [files, setFiles] = React.useState<Partial<Record<TaeEvidenceKind, File>>>({})
  const [compressing, setCompressing] = React.useState<Partial<Record<TaeEvidenceKind, boolean>>>({})
  const [formError, setFormError] = React.useState<string | null>(null)
  const identityScope = config ? `${config.worksite.id}:${config.loadingPoint?.id ?? "none"}` : null
  const driverIdentity = useTaeIdentity("driver", accessToken, identityScope)
  const supervisorIdentity = useTaeIdentity("supervisor", accessToken, identityScope)

  const refreshQueue = React.useCallback(async () => {
    const [pending, failedItems] = await Promise.all([countPendingTaeSubmissions(), getFailedTaeSubmissions()])
    setPendingCount(pending)
    setFailed(failedItems)
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
        const body = await response.json() as { ok: boolean; data?: AccessConfig }
        if (!response.ok || !body.ok || !body.data) {
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
        const cached = await getTaeAccessConfig<AccessConfig>()
        if (cached) {
          setConfig(cached)
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

  async function selectEvidence(kind: TaeEvidenceKind, file: File | undefined) {
    if (!file) { setFiles((current) => ({ ...current, [kind]: undefined })); return }
    setCompressing((current) => ({ ...current, [kind]: true }))
    try {
      const compressed = await compressPhoto(file)
      setFiles((current) => ({ ...current, [kind]: compressed }))
    } catch {
      setFiles((current) => ({ ...current, [kind]: undefined }))
      toast.error("No se pudo procesar la fotografía. Toma otra foto o selecciona una imagen JPG/PNG.")
    } finally {
      setCompressing((current) => ({ ...current, [kind]: false }))
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    if (!accessToken || !config) return
    const form = new FormData(event.currentTarget)
    const vehicle = config.vehicles.find((item) => item.id === vehicleId)
    if (!vehicle) { setFormError("Selecciona el equipo"); toast.error("Selecciona el equipo"); return }
    const missing = EVIDENCE.filter(({ kind }) => !files[kind])
    if (missing.length) { setFormError("Debes adjuntar las cuatro evidencias"); toast.error("Debes adjuntar las cuatro evidencias"); return }
    const payload = {
      clientSubmissionId: newClientId(),
      worksiteId: config.worksite.id,
      loadingPointId: config.loadingPoint?.id ?? "",
      vehicleId: vehicle.id,
      equipmentCode: vehicle.code ?? vehicle.plate,
      plate: vehicle.plate,
      loadedAt: new Date().toISOString(),
      driverWorkerId: driverIdentity.matched?.id ?? "",
      driverName: String(form.get("driverName") ?? ""),
      supervisorWorkerId: supervisorIdentity.matched?.id ?? "",
      supervisorName: String(form.get("supervisorName") ?? ""),
      manualIdentity: !driverIdentity.matched || !supervisorIdentity.matched,
      meterType,
      meterReading: null,
      meterUnavailableReason: "",
      liters: Number(form.get("liters")),
      removedSealNumber: String(form.get("removedSealNumber") ?? ""),
      installedSealNumber: String(form.get("installedSealNumber") ?? ""),
      noSealReason: String(form.get("noSealReason") ?? ""),
      notes: String(form.get("notes") ?? ""),
    }
    const evidence = EVIDENCE.map(({ kind }) => ({ kind, blob: files[kind]!, fileName: files[kind]!.name }))
    setSubmitting(true)
    try {
      if (!navigator.onLine) {
        // No se puede afirmar "guardado offline" si el navegador no logró
        // escribir las fotos — QuotaExceededError debe bloquear con un
        // mensaje explícito, nunca reportarse como éxito (decisión de Fase 0).
        try {
          await enqueueTaeSubmission(accessToken, payload, evidence)
          void registerTaeBackgroundSync()
        } catch (error) {
          toast.error(isQuotaExceeded(error)
            ? "No hay espacio suficiente en este dispositivo para guardar las fotos. Libera espacio e inténtalo de nuevo."
            : "No se pudo guardar la carga en este dispositivo. Inténtalo nuevamente.")
          return
        }
        await refreshQueue()
        event.currentTarget.reset(); setFiles({}); setVehicleId("")
        toast.success("Carga guardada en este dispositivo. Se enviará al recuperar conexión.")
        return
      }
      const token = await sendQueued({ id: payload.clientSubmissionId, accessToken, payload, evidence, attempts: 0 })
      router.push(`/tae/resultado/${token}`)
    } catch (error) {
      if (error instanceof TaeSubmissionError && !error.retryable) {
        setFormError(error.message)
        toast.error(error.message)
        return
      }
      try {
        await enqueueTaeSubmission(accessToken, payload, evidence)
        void registerTaeBackgroundSync()
        await refreshQueue()
        toast.warning("No se pudo enviar. La carga quedó guardada localmente para sincronizarse.")
      } catch (error) {
        toast.error(isQuotaExceeded(error)
          ? "No se pudo enviar ni guardar offline: sin espacio de almacenamiento en el dispositivo."
          : "No se pudo enviar ni guardar la carga. Inténtalo nuevamente.")
      }
    } finally { setSubmitting(false) }
  }

  if (loading) return <main className="mx-auto flex min-h-dvh max-w-lg items-center justify-center px-4"><CircleNotch className="animate-spin text-[var(--color-primary)]" size={30} /></main>
  if (!config) return <main className="mx-auto flex min-h-dvh max-w-lg items-center px-4"><div className="w-full rounded-[var(--radius-2xl)] border border-(--color-border) bg-(--color-surface) p-6 text-center"><QrCode className="mx-auto text-[var(--color-primary)]" size={34} /><h1 className="mt-4 text-h2">Escanea el QR TAE</h1><p className="mt-1 text-sm text-[var(--color-text-muted)]">Este dispositivo aún no tiene un acceso TAE configurado.</p></div></main>

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-6">
      <header className="mb-6 border-b border-(--color-rule) pb-4">
        <p className="text-eyebrow">Control operacional</p>
        <h1 className="mt-1 text-xl font-semibold">Carga TAE</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">{config.worksite.name}{config.loadingPoint ? ` · ${config.loadingPoint.name}` : ""}</p>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]" aria-live="polite">{online ? <CloudArrowUp size={14} /> : <WifiSlash size={14} />}{online ? "Conectado" : "Sin conexión"}{pendingCount > 0 ? ` · ${pendingCount} pendiente(s)` : ""}{failed.length > 0 ? ` · ${failed.length} rechazada(s)` : ""}</p>
      </header>

      {failed.length > 0 && (
        <section className="mb-5 border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] p-3" aria-label="Cargas rechazadas">
          <p className="text-sm font-medium text-[var(--color-danger-ink)]">Hay cargas que requieren volver a ingresarse</p>
          <ul className="mt-2 space-y-2 text-xs text-[var(--color-danger-ink)]">
            {failed.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3">
                <span>{item.lastError ?? "La plataforma rechazó esta carga"} · {new Date(item.createdAt).toLocaleString("es-CL")}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => void deleteTaeSubmission(item.id).then(refreshQueue)}>Descartar</Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form onSubmit={submit} className="space-y-5">
        {formError && <div role="alert" aria-live="assertive" className="border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] p-3 text-sm text-[var(--color-danger-ink)]">{formError}</div>}
        <section className="space-y-3">
          <h2 className="text-h3">Responsables y equipo</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div>
                <Label htmlFor="tae-driver-rut">RUT del conductor</Label>
                <div className="flex gap-2">
                  <Input id="tae-driver-rut" value={driverIdentity.rut} onChange={(event) => driverIdentity.setRut(event.target.value)} placeholder="12345678-9" />
                  <Button type="button" variant="secondary" onClick={driverIdentity.verify} disabled={driverIdentity.verifying || !driverIdentity.rut}>{driverIdentity.verifying ? "..." : "Verificar"}</Button>
                </div>
                {driverIdentity.matched && <p className="mt-1 text-xs text-[var(--color-success-ink)]">Verificado: {driverIdentity.matched.name}</p>}
              </div>
              <div><Label htmlFor="tae-driver">Nombre completo del conductor</Label><Input id="tae-driver" name="driverName" required placeholder="Nombre completo" /></div>
            </div>
            <div className="space-y-2">
              <div>
                <Label htmlFor="tae-supervisor-rut">RUT del supervisor o líder</Label>
                <div className="flex gap-2">
                  <Input id="tae-supervisor-rut" value={supervisorIdentity.rut} onChange={(event) => supervisorIdentity.setRut(event.target.value)} placeholder="12345678-9" />
                  <Button type="button" variant="secondary" onClick={supervisorIdentity.verify} disabled={supervisorIdentity.verifying || !supervisorIdentity.rut}>{supervisorIdentity.verifying ? "..." : "Verificar"}</Button>
                </div>
                {supervisorIdentity.matched && <p className="mt-1 text-xs text-[var(--color-success-ink)]">Verificado: {supervisorIdentity.matched.name}</p>}
              </div>
              <div><Label htmlFor="tae-supervisor">Nombre completo del supervisor o líder</Label><Input id="tae-supervisor" name="supervisorName" required placeholder="Nombre completo" /></div>
            </div>
          </div>
          <div><Label htmlFor="tae-vehicle">Equipo</Label><Select value={vehicleId} onValueChange={setVehicleId}><SelectTrigger id="tae-vehicle"><SelectValue placeholder="Selecciona el equipo" /></SelectTrigger><SelectContent>{config.vehicles.map((vehicle) => <SelectItem key={vehicle.id} value={vehicle.id}>{vehicle.code ?? vehicle.plate} · {vehicle.plate}</SelectItem>)}</SelectContent></Select></div>
        </section>

        <section className="space-y-3 border-t border-(--color-border) pt-5">
          <h2 className="text-h3">Carga</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="tae-meter-type">Tipo de lectura</Label><Select value={meterType} onValueChange={(value) => setMeterType(value as "odometer" | "hour_meter")}><SelectTrigger id="tae-meter-type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="odometer">Odómetro</SelectItem><SelectItem value="hour_meter">Horómetro</SelectItem></SelectContent></Select></div>
            <div><Label htmlFor="tae-liters">Litros</Label><Input id="tae-liters" name="liters" type="number" min="0.01" step="0.001" inputMode="decimal" required /></div>
          </div>
        </section>

        <section className="space-y-3 border-t border-(--color-border) pt-5">
          <h2 className="text-h3">Sellos</h2>
          <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="tae-removed">Sello retirado</Label><Input id="tae-removed" name="removedSealNumber" /></div><div><Label htmlFor="tae-installed">Sello instalado</Label><Input id="tae-installed" name="installedSealNumber" /></div></div>
          <div><Label htmlFor="tae-seal-reason">Motivo sin sello</Label><Input id="tae-seal-reason" name="noSealReason" placeholder="Solo si no hay sello" /></div>
        </section>

        <section className="space-y-3 border-t border-(--color-border) pt-5">
          <h2 className="text-h3">Evidencias</h2>
          <div className="grid gap-3 sm:grid-cols-2">{EVIDENCE.map(({ kind, label }) => <EvidenceInput key={kind} kind={kind} label={label} file={files[kind]} compressing={Boolean(compressing[kind])} onSelect={(file) => void selectEvidence(kind, file)} />)}</div>
        </section>

        <div><Label htmlFor="tae-notes">Observaciones</Label><Textarea id="tae-notes" name="notes" rows={3} /></div>
        <Button type="submit" className="w-full" size="lg" disabled={submitting || Object.values(compressing).some(Boolean)}>{submitting ? <><CircleNotch className="animate-spin" size={16} /> Guardando</> : "Registrar carga TAE"}</Button>
      </form>
    </main>
  )
}
