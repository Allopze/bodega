"use client"

import { useEffect, useState } from "react"
import { toast } from "@/lib/toast"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { EmptyState } from "@/components/ui/empty-state"
import { formatDate, formatDateTime } from "@/lib/utils"
import {
  listRe20OfflineDrafts,
  listRe20VaultProfiles,
  lockRe20Vault,
  unlockRe20Vault,
  type OfflineDraft,
} from "@/lib/prevention/re20-offline-vault"
import { migrateLegacyIncidentReportQueue } from "@/app/(app)/prevencion/incidentes/reportar/offline-incident-queue"
import { Re20WorkspaceShell } from "@/app/(app)/prevencion/incidentes/[id]/re20/re20-workspace-shell"
import type { Re20LocalDraft } from "@/app/(app)/prevencion/incidentes/[id]/re20/types"
import { Re20VaultGate } from "@/app/(app)/prevencion/incidentes/[id]/re20/vault-gate"
import { IncidentReportForm } from "@/app/(app)/prevencion/incidentes/reportar/incident-report-form"

type VaultProfile = Awaited<ReturnType<typeof listRe20VaultProfiles>>[number]
type OfflineReportConfig = { worksites: Array<{ id: string; name: string; code: string }>; defaultDate: string; defaultTime: string }

function currentChileDateTime() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date())
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return { date: `${value.year}-${value.month}-${value.day}`, time: `${value.hour}:${value.minute}` }
}

export function Re20OfflineShell() {
  const [profiles, setProfiles] = useState<VaultProfile[]>([])
  const [selectedUserId, setSelectedUserId] = useState("")
  const [unlocked, setUnlocked] = useState(false)
  const [headers, setHeaders] = useState<Array<OfflineDraft<unknown>>>([])
  const [workspaceDrafts, setWorkspaceDrafts] = useState<Array<OfflineDraft<Re20LocalDraft>>>([])
  const [selectedDraftId, setSelectedDraftId] = useState("")
  const [reportConfig, setReportConfig] = useState<OfflineReportConfig | null>(null)
  const [showOfflineReportForm, setShowOfflineReportForm] = useState(false)

  useEffect(() => {
    void listRe20VaultProfiles().then(setProfiles).catch(() => {})
  }, [])

  useEffect(() => {
    const handleVaultLock = (event: Event) => {
      const lockedUserId = (event as CustomEvent<{ userId?: string }>).detail?.userId
      if (!lockedUserId || lockedUserId !== selectedUserId) return
      setUnlocked(false)
      setHeaders([])
      setWorkspaceDrafts([])
      setSelectedDraftId("")
      setReportConfig(null)
      setShowOfflineReportForm(false)
    }
    window.addEventListener("re20-vault-locked", handleVaultLock)
    return () => window.removeEventListener("re20-vault-locked", handleVaultLock)
  }, [selectedUserId])

  const selectedDraft = workspaceDrafts.find((draft) => draft.id === selectedDraftId) ?? workspaceDrafts[0]
  const payload = selectedDraft?.payload
  const context = payload?.context

  async function unlock(passphrase: string, profileUserId?: string) {
    const userId = profileUserId ?? profiles[0]?.userId
    if (!userId) return
    await unlockRe20Vault(userId, passphrase)
    await migrateLegacyIncidentReportQueue(userId)
    const drafts = await listRe20OfflineDrafts<unknown>(userId)
    const workspaces = drafts.filter((draft): draft is OfflineDraft<Re20LocalDraft> => draft.kind === "incident_workspace")
    const storedReportConfig = drafts.find((draft) => draft.kind === "incident_report_config")?.payload as OfflineReportConfig | undefined
    setSelectedUserId(userId)
    setHeaders(drafts)
    setWorkspaceDrafts(workspaces)
    setReportConfig(storedReportConfig ?? null)
    setSelectedDraftId(workspaces[0]?.id ?? "")
    setUnlocked(true)
    toast.success("Bóveda abierta en este dispositivo.")
  }

  async function reloadDrafts() {
    if (!selectedUserId) return
    const drafts = await listRe20OfflineDrafts<unknown>(selectedUserId)
    setHeaders(drafts)
    setWorkspaceDrafts(drafts.filter((draft): draft is OfflineDraft<Re20LocalDraft> => draft.kind === "incident_workspace"))
    setReportConfig(drafts.find((draft) => draft.kind === "incident_report_config")?.payload as OfflineReportConfig | undefined ?? null)
  }

  function lock() {
    lockRe20Vault(selectedUserId)
    setUnlocked(false)
    setHeaders([])
    setWorkspaceDrafts([])
    setSelectedDraftId("")
    setReportConfig(null)
    setShowOfflineReportForm(false)
  }

  const reportCount = headers.filter((item) => item.kind === "incident_report").length

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 bg-[var(--color-bg)] px-4 py-6 text-[var(--color-text)] md:px-8">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Trabajo sin conexión</h1>
        <p className="max-w-3xl text-sm text-[var(--color-text-muted)]">Aquí sigues los borradores de investigación y los reportes guardados en este dispositivo. Todo se descifra solo aquí, con la frase del dispositivo; para enviarlos, vuelve a abrir el caso con sesión y conexión.</p>
      </header>

      <Re20VaultGate
        configured={profiles.length > 0}
        unlocked={unlocked}
        profiles={profiles.map((profile, index) => ({ userId: profile.userId, label: `Bóveda ${index + 1} · creada ${formatDate(profile.createdAt)}` }))}
        onUnlock={unlock}
        onLock={lock}
        pendingSummary={unlocked ? `${reportCount} ${reportCount === 1 ? "reporte" : "reportes"} sin enviar · ${workspaceDrafts.length} ${workspaceDrafts.length === 1 ? "expediente" : "expedientes"} de investigación` : null}
        unlockedActions={<Button type="button" size="sm" variant="secondary" onClick={() => void reloadDrafts()}>Actualizar lista</Button>}
      />

      {unlocked && <>
        {workspaceDrafts.length === 0 ? (
          <EmptyState
            compact
            align="start"
            title="No hay expedientes preparados para trabajar sin conexión"
            description="Con conexión, abre el incidente, abre la bóveda desde «Preparar para trabajar sin conexión» y guarda una copia antes de salir a terreno."
          />
        ) : <>
          {workspaceDrafts.length > 1 && (
            <nav aria-label="Expedientes guardados en este dispositivo" className="flex gap-2 overflow-x-auto pb-1">
              {workspaceDrafts.map((draft) => {
                const active = (selectedDraft?.id ?? "") === draft.id
                return (
                  <button key={draft.id} type="button" aria-current={active ? "page" : undefined} onClick={() => setSelectedDraftId(draft.id)} className={`min-h-11 shrink-0 rounded-[var(--radius-lg)] border px-3 py-2 text-left text-sm transition-colors duration-150 ${active ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)]" : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"}`}>
                    <span className="block font-semibold">{draft.payload.context?.incident?.code ?? "Incidente"}</span>
                    <span className="block text-xs tabular-nums text-[var(--color-text-muted)]">Guardado {formatDateTime(draft.updatedAt)}</span>
                  </button>
                )
              })}
            </nav>
          )}
          {payload && context ? (
            <Re20WorkspaceShell
              key={selectedDraft?.id}
              incident={{ ...context.incident, location: context.incident.location ?? "", isFatalOrSerious: context.incident.isFatalOrSerious ?? false }}
              workspace={{ version: payload.baseVersion, data: payload.baseData, updatedAt: payload.savedAt }}
              policy={context.policy}
              options={context.options}
              qualityReviews={context.qualityReviews}
              legacyInvestigation={context.legacyInvestigation}
              sensitivePayload={(payload.sensitive as Record<string, unknown> | undefined) ?? null}
              sensitiveLoadError={null}
              permissions={{
                canInvestigate: true,
                canSensitive: context.canSensitive,
                canNotify: context.canNotify,
                canReview: context.canReview,
                canConfigure: false,
                canConfirmDiffusion: context.canConfirmDiffusion,
              }}
              currentUser={context.currentUser}
              userId={selectedUserId}
              people={context.people ?? []}
              involvedPeople={context.involvedPeople ?? []}
              diffusions={context.diffusions}
              notifications={context.notifications}
              capa={context.capa}
              initialPurpose=""
              offlineOnly
              initialLocalDraft={payload}
            />
          ) : (
            <Callout tone="warning">Este borrador se guardó con una versión anterior y no trae lo necesario para abrirlo sin conexión. Sus datos se conservan: ábrelo con conexión desde el incidente.</Callout>
          )}
        </>}

        <section aria-labelledby="offline-report-title" className="space-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="offline-report-title" className="font-semibold">Nuevo reporte de incidente</h2>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">Se guarda cifrado aquí y se envía después, desde una sesión con conexión.</p>
            </div>
            {reportConfig && <Button type="button" variant="secondary" onClick={() => setShowOfflineReportForm((visible) => !visible)}>{showOfflineReportForm ? "Cerrar formulario" : "Crear reporte sin conexión"}</Button>}
          </div>
          {!reportConfig && <p className="text-sm text-[var(--color-text-muted)]">Para reportar sin conexión, abre una vez el formulario de reportes con conexión y abre la bóveda: así quedan guardadas las faenas que puedes usar.</p>}
          {showOfflineReportForm && reportConfig && (() => { const now = currentChileDateTime(); return <IncidentReportForm key={selectedUserId} worksites={reportConfig.worksites} defaultDate={now.date} defaultTime={now.time} userId={selectedUserId} offlineOnly /> })()}
        </section>
      </>}
    </main>
  )
}
