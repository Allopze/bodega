"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { EmptyState } from "@/components/ui/empty-state"
import { formatDateTime } from "@/lib/utils"
import {
  lastRe20OfflineDraftOwner,
  listRe20OfflineDrafts,
  type OfflineDraft,
} from "@/lib/prevention/re20-offline-drafts"
import { Re20WorkspaceShell } from "@/app/(app)/prevencion/incidentes/[id]/re20/re20-workspace-shell"
import type { Re20LocalDraft } from "@/app/(app)/prevencion/incidentes/[id]/re20/types"
import { IncidentReportForm } from "@/app/(app)/prevencion/incidentes/reportar/incident-report-form"

type OfflineReportConfig = { worksites: Array<{ id: string; name: string; code: string }>; defaultDate: string; defaultTime: string }

function currentChileDateTime() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date())
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return { date: `${value.year}-${value.month}-${value.day}`, time: `${value.hour}:${value.minute}` }
}

/**
 * Trabajo sin conexión de Incidentes / RE-20, sin sesión: muestra directamente
 * lo que quedó guardado en este equipo por la última persona que trabajó aquí.
 * No hay frase ni desbloqueo; para enviarlo hay que abrir la aplicación con
 * sesión y conexión (el cierre de sesión vacía este almacén).
 */
export function Re20OfflineShell() {
  const [loaded, setLoaded] = useState(false)
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Array<OfflineDraft<unknown>>>([])
  const [workspaceDrafts, setWorkspaceDrafts] = useState<Array<OfflineDraft<Re20LocalDraft>>>([])
  const [selectedDraftId, setSelectedDraftId] = useState("")
  const [reportConfig, setReportConfig] = useState<OfflineReportConfig | null>(null)
  const [showOfflineReportForm, setShowOfflineReportForm] = useState(false)

  const load = useCallback(async () => {
    try {
      const owner = await lastRe20OfflineDraftOwner()
      const stored = owner ? await listRe20OfflineDrafts<unknown>(owner) : []
      const workspaces = stored.filter((draft): draft is OfflineDraft<Re20LocalDraft> => draft.kind === "incident_workspace")
      setOwnerUserId(owner)
      setDrafts(stored)
      setWorkspaceDrafts(workspaces)
      setReportConfig(stored.find((draft) => draft.kind === "incident_report_config")?.payload as OfflineReportConfig | undefined ?? null)
      setSelectedDraftId((current) => (workspaces.some((draft) => draft.id === current) ? current : workspaces[0]?.id ?? ""))
    } catch {
      /* sin almacenamiento local no hay nada que mostrar: queda el estado vacío */
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const selectedDraft = workspaceDrafts.find((draft) => draft.id === selectedDraftId) ?? workspaceDrafts[0]
  const payload = selectedDraft?.payload
  const context = payload?.context
  const reportCount = drafts.filter((item) => item.kind === "incident_report").length
  const hasWork = reportCount > 0 || workspaceDrafts.length > 0

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 bg-[var(--color-bg)] px-4 py-6 text-[var(--color-text)] md:px-8">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Trabajo sin conexión</h1>
        <p className="max-w-3xl text-sm text-[var(--color-text-muted)]">Aquí sigues los borradores de investigación y los reportes guardados en este equipo. Para enviarlos, abre la aplicación con sesión y conexión. No cierres sesión hasta entonces: al cerrarla, lo guardado aquí se borra.</p>
      </header>

      {loaded && !ownerUserId && (
        <EmptyState
          align="start"
          title="No hay trabajo guardado en este equipo"
          description="Lo que escribas sin conexión en un reporte o en un expediente de investigación se guarda aquí solo. Para tener un expediente a mano, ábrelo con conexión y sigue trabajando aunque se corte la señal."
          action={<Button asChild variant="secondary" size="sm"><Link href="/prevencion/incidentes">Ir a incidentes</Link></Button>}
        />
      )}

      {ownerUserId && <>
        <Callout tone="info" role="status">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>
              {hasWork
                ? `${reportCount} ${reportCount === 1 ? "reporte guardado" : "reportes guardados"} en este equipo · ${workspaceDrafts.length} ${workspaceDrafts.length === 1 ? "expediente" : "expedientes"} de investigación con cambios sin enviar.`
                : "No hay reportes ni expedientes con cambios sin enviar en este equipo."}
            </p>
            <Button type="button" size="sm" variant="secondary" onClick={() => void load()}>Actualizar lista</Button>
          </div>
        </Callout>

        {workspaceDrafts.length === 0 ? (
          <EmptyState
            compact
            align="start"
            title="No hay expedientes con cambios guardados en este equipo"
            description="Lo que escribas en un expediente sin conexión se guarda aquí solo. Para trabajar uno sin señal, ábrelo con conexión antes de salir a terreno."
          />
        ) : <>
          {workspaceDrafts.length > 1 && (
            <nav aria-label="Expedientes guardados en este equipo" className="flex gap-2 overflow-x-auto pb-1">
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
              userId={ownerUserId}
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
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">Se guarda en este equipo y se envía solo cuando abras la aplicación con conexión.</p>
            </div>
            {reportConfig && <Button type="button" variant="secondary" onClick={() => setShowOfflineReportForm((visible) => !visible)}>{showOfflineReportForm ? "Cerrar formulario" : "Crear reporte sin conexión"}</Button>}
          </div>
          {!reportConfig && <p className="text-sm text-[var(--color-text-muted)]">Para reportar sin conexión, abre «Reportar incidente» una vez con conexión: así quedan guardadas en este equipo las faenas que puedes usar.</p>}
          {showOfflineReportForm && reportConfig && (() => { const now = currentChileDateTime(); return <IncidentReportForm key={ownerUserId} worksites={reportConfig.worksites} defaultDate={now.date} defaultTime={now.time} userId={ownerUserId} offlineOnly /> })()}
        </section>
      </>}
    </main>
  )
}
