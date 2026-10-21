"use client"

import type { Re20WorkspaceApi } from "./use-re20-workspace"

import * as React from "react"
import Link from "next/link"
import { Printer } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { MetaBadge } from "@/components/states/state-badge"
import { INCIDENT_STATUS_LABELS, incidentStatusBadgeVariant } from "@/lib/prevention/incidents"
import { formatDateTime } from "@/lib/utils"
import type { IncidentStatus } from "@/lib/services/prevention-incidents"
import { Re20ConflictDialog } from "./conflict-dialog"
import { Re20SensitiveVeil } from "./sensitive-veil"
import { Re20MissingList, Re20MobileBar, Re20NextStep, Re20SaveIndicator, Re20StageNav } from "./shell-parts"
import { RE20_STAGE_MODULES, re20StageViews } from "./stages"
import type { Re20WorkspaceProps } from "./types"
import { isRe20StageId, Re20WorkspaceContext, useRe20Workspace } from "./use-re20-workspace"
import { cn } from "@/lib/utils"

/**
 * Expediente RE-20: el protocolo PASO A PASO como recorrido. Arriba, qué caso
 * es, su estado y UN indicador de guardado; luego la única acción esperada
 * («Siguiente paso»), las etapas que aplican y la etapa abierta con lo que le
 * falta. Cada etapa se pinta desde `stages/<id>.tsx`.
 */
export function Re20WorkspaceShell(props: Re20WorkspaceProps) {
  const ws = useRe20Workspace(props)
  const views = re20StageViews(ws, ws.now)
  const current = views.find((view) => view.id === ws.stage) ?? views[0]!
  const applicable = views.filter((view) => view.applicable)
  const currentIndex = applicable.findIndex((view) => view.id === current.id)
  const nextStage = currentIndex >= 0 ? applicable[currentIndex + 1] ?? null : applicable[0] ?? null
  const StageComponent = RE20_STAGE_MODULES[current.id].Component
  const [conflictOpen, setConflictOpen] = React.useState(false)
  const conflictCount = ws.conflicts.filter((item) => !item.choice).length + (ws.sensitiveConflict ? 1 : 0)
  const statusLabel = INCIDENT_STATUS_LABELS[ws.incident.status as IncidentStatus] ?? "Estado sin definir"
  const closed = ws.incident.status === "closed"

  // Sin `?etapa=` el expediente abre en el primer paso pendiente, no siempre en el 1.
  const openedAt = React.useRef(props.initialStage)
  React.useEffect(() => {
    if (isRe20StageId(openedAt.current)) return
    openedAt.current = "preliminar"
    const pending = views.find((view) => view.applicable && view.status !== "done")
    if (pending && pending.id !== ws.stage) ws.setStage(pending.id, { quiet: true })
  // Sólo al montar.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Re20WorkspaceContext.Provider value={ws}>
      <section aria-labelledby="re20-title" className="space-y-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 pb-32 shadow-xs md:p-6 md:pb-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="re20-title" className="text-lg font-semibold text-[var(--color-text)]">Investigación {ws.incident.code}</h2>
              <MetaBadge meta={{ label: statusLabel, variant: incidentStatusBadgeVariant(ws.incident.status) }} />
            </div>
            <Re20SaveIndicator ws={ws} className="hidden md:block" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!ws.offlineOnly && (
              <Button asChild variant="secondary" size="sm">
                <Link href={`/prevencion/incidentes/${ws.incident.id}/re20/print${ws.sensitiveAvailable && ws.purpose.length >= 3 ? `?sensitive=1&purpose=${encodeURIComponent(ws.purpose)}` : ""}`} target="_blank">
                  <Printer aria-hidden className="size-4" />Imprimir expediente
                </Link>
              </Button>
            )}
            {!ws.readOnly && (
              <Button type="button" size="sm" className="hidden md:inline-flex" loading={ws.saving} disabled={!ws.dirty && ws.status !== "error"} onClick={() => void ws.save()}>
                {ws.offlineOnly || !ws.online ? "Guardar en este equipo" : "Guardar"}
              </Button>
            )}
          </div>
        </header>

        {ws.readOnly && (
          <Callout tone="info" title={closed ? "Caso cerrado" : "Solo lectura"}>
            {closed
              ? "El expediente sustentó el cierre del incidente y ya no se puede modificar."
              : "Puedes revisar el expediente, pero tu perfil no permite editar la investigación."}
          </Callout>
        )}

        {ws.status === "error" && ws.errorMessage && (
          <Callout tone="danger" role="alert" title="No se guardó">
            <p>{ws.errorMessage}</p>
          </Callout>
        )}

        {conflictCount > 0 && (
          <Callout tone="warning" role="alert" title="Otra persona guardó cambios mientras trabajabas">
            <p>Tus cambios siguen aquí. Elige qué conservar en {conflictCount} {conflictCount === 1 ? "parte" : "partes"} y luego guarda.</p>
            <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => setConflictOpen(true)}>Revisar diferencias</Button>
          </Callout>
        )}
        {conflictCount === 0 && ws.conflicts.length > 0 && (
          <Callout tone="info" title="Elegiste qué conservar">
            <Button type="button" size="sm" className="mt-1" onClick={ws.applyConflictResolution}>Aplicar y seguir</Button>
          </Callout>
        )}
        {ws.sensitiveBaseConflict && (
          <Callout tone="warning" role="alert" title="Los datos reservados cambiaron en el servidor">
            Ábrelos con un propósito para comparar tu versión con la guardada antes de enviarla.
          </Callout>
        )}
        {ws.localSensitivePending && (
          <Callout tone="warning" role="alert">
            Este borrador trae datos reservados que tu perfil no puede abrir. Queda guardado en este equipo hasta que lo abra una persona con acceso reservado.
          </Callout>
        )}

        {ws.readOnly && <Re20SensitiveVeil standalone title="Datos reservados" />}

        {ws.legacyInvestigation && (
          <details className="rounded-[var(--radius-lg)] border border-[var(--color-border)] px-4 py-2 text-sm">
            <summary className="flex min-h-11 cursor-pointer items-center font-medium text-[var(--color-text)]">Investigación registrada antes del expediente actual</summary>
            <div className="space-y-2 pb-2 text-[var(--color-text-muted)]">
              {ws.legacyInvestigation.preliminaryReportText && <p className="whitespace-pre-wrap">{ws.legacyInvestigation.preliminaryReportText}</p>}
              {ws.legacyInvestigation.conclusions && <p className="whitespace-pre-wrap">{ws.legacyInvestigation.conclusions}</p>}
              {[...ws.legacyInvestigation.immediateCauses, ...ws.legacyInvestigation.basicCauses, ...ws.legacyInvestigation.organizationalCauses].length > 0 && (
                <ul className="list-disc pl-5">
                  {[...ws.legacyInvestigation.immediateCauses, ...ws.legacyInvestigation.basicCauses, ...ws.legacyInvestigation.organizationalCauses].map((cause, index) => <li key={`${cause}-${index}`}>{cause}</li>)}
                </ul>
              )}
            </div>
          </details>
        )}

        {!closed && <Re20NextStep ws={ws} views={views} />}

        <Re20StageNav ws={ws} views={views} />

        <section aria-labelledby={`re20-stage-${current.id}-title`} className="space-y-4 border-t border-[var(--color-border)] pt-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)] md:items-start">
            <div className="min-w-0 space-y-1">
              <h3 id={`re20-stage-${current.id}-title`} tabIndex={-1} className="text-base font-semibold text-[var(--color-text)] outline-none">
                {current.number}. {current.title}
              </h3>
              <p className="text-sm text-[var(--color-text-muted)]">{current.summary}</p>
              {current.deadline && (
                <p className={cn("text-xs tabular-nums", current.deadlineState === "ok" ? "text-[var(--color-text-muted)]" : "text-[var(--color-signal-ink)] font-medium")}>
                  {current.deadline.kind === "legal" ? "Plazo legal" : "Vence"} {formatDateTime(current.deadline.dueAt)} · {current.deadline.rule}
                </p>
              )}
            </div>
            {current.applicable && <Re20MissingList ws={ws} view={current} />}
          </div>
          {current.applicable ? (
            <fieldset disabled={stageLocked(ws, current.id)} className="min-w-0 disabled:opacity-100">
              <legend className="sr-only">{current.title}</legend>
              <StageComponent ws={ws} stage={current} />
            </fieldset>
          ) : (
            <p className="text-sm text-[var(--color-text-muted)]">{current.reason}</p>
          )}
        </section>
      </section>

      <Re20MobileBar ws={ws} nextStage={nextStage} />

      <Re20ConflictDialog
        open={conflictOpen}
        onOpenChange={setConflictOpen}
        conflicts={ws.conflicts}
        sensitiveConflict={ws.sensitiveConflict}
        remoteAuthor={ws.remoteUpdatedByName}
        remoteAt={ws.remoteUpdatedAt}
        onChoose={ws.resolveConflict}
        onChooseSensitive={ws.resolveSensitiveConflict}
        onApply={ws.applyConflictResolution}
        personName={(userId) => ws.people.find((person) => person.id === userId)?.name}
      />
    </Re20WorkspaceContext.Provider>
  )
}

/**
 * Calidad y difusión las ejecutan personas distintas del equipo investigador
 * (revisora con `review_quality`, quien confirma con `diffuse`): bloquearlas por
 * no poder investigar dejaba sin formulario justo a quien debe usarlo. Cada
 * etapa decide con sus permisos y el servidor vuelve a validarlos.
 */
function stageLocked(ws: Re20WorkspaceApi, stageId: string) {
  if (stageId === "calidad" || stageId === "difusion") return ws.incident.status === "closed"
  return ws.readOnly
}
