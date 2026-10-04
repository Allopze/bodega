"use client"

import { useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { EmptyState } from "@/components/ui/empty-state"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import type { CompletenessIssue } from "@/lib/prevention/miper/completeness"
import { stepOfField, type EditorStep } from "@/lib/prevention/miper/entry-navigation"
import { PREPARATION_GROUPS, preparationGroupOf } from "@/lib/prevention/miper/preparation"
import { hrefToReviewWalk, reviewQuickFilters } from "@/lib/prevention/miper/review-walk"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import { REVIEW_STAGE_FOR_STATE, STAGE_LABEL, type MiperReviewState } from "@/lib/prevention/miper/states"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import type { MiperWorkspace } from "@/lib/services/miper/queries"
import { countOf, formatDateTime } from "@/lib/utils"
import { addMiperObservationAction } from "../actions"
import { ObservationItem } from "./observation-item"
import { WorkspaceLink } from "./workspace-nav"

export type ReviewPanelProps = {
  workspace: MiperWorkspace
  mode: WorkspaceMode
  onOpenEntry: (entryId: string, step?: EditorStep) => void
  /** Bloqueos de envío que calcula el validador del servidor; sin ellos no se pinta la preparación. */
  issues?: readonly CompletenessIssue[]
  onOpenFicha?: () => void
  rows: readonly MiperEntrySnapshot[]
  observed: ReadonlySet<string>
  modified: ReadonlySet<string>
  hasBaseline: boolean
}

export function ReviewPanel({ workspace, mode, onOpenEntry, issues, onOpenFicha, rows, observed, modified, hasBaseline }: ReviewPanelProps) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const quickFilters = reviewQuickFilters(rows, { observed, modified, hasBaseline })
  const [body, setBody] = useState("")
  // La acción revalida la página de la matriz (`guarded` con `matrixId`). Un `router.refresh()`
  // encima era un segundo viaje RSC y, con la URL ya cambiada por `navigateWorkspace`, dos
  // desajustes de árbol seguidos hacen que Next recargue el documento entero (se perdía el aviso).
  const operation = useOperation({ feedback: "toast" })
  const { matrix } = workspace
  const currentStage = currentStageOf(workspace)
  const groups = [
    { key: "open", title: "Por responder" },
    { key: "answered", title: "Por confirmar" },
    { key: "resolved", title: "Resueltas" },
  ] as const
  const blocking = (issues ?? []).filter((issue) => issue.severity === "error")
  const preparing = Boolean(issues) && mode.canEdit && ["none", "observed"].includes(matrix.reviewState) && currentStage === 0
  const openCount = workspace.observations.filter((item) => item.status === "open").length
  return (
    <section className="space-y-4">
      <ReviewStateSection workspace={workspace} mode={mode} currentStage={currentStage} />
      {preparing && <PreparationSection blocking={blocking} rows={rows} onOpenEntry={onOpenEntry} onOpenFicha={onOpenFicha} />}
      {/* Lectura: la ven todos los que ven la pestaña. Cada atajo abre el editor en el primer riesgo del filtro, con el filtro en la URL. */}
      <section aria-labelledby="review-walk-title" className="space-y-2">
        <h2 id="review-walk-title" className="text-sm font-semibold">Recorrer la MIPER</h2>
        <ul className="flex flex-wrap gap-2 text-sm">
          {quickFilters.map((filter) => (
            <li key={filter.key}>
              {filter.firstEntryId
                ? <WorkspaceLink href={hrefToReviewWalk(pathname, params, filter.patch, filter.firstEntryId)} className="inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 font-medium text-[var(--color-primary-ink)] hover:underline">{filter.label} ({filter.count})</WorkspaceLink>
                : <span className="inline-flex px-3 py-1 text-[var(--color-text-subtle)]">Sin {filter.label.toLowerCase()}</span>}
            </li>
          ))}
        </ul>
      </section>
      {mode.canRespond && (
        <Callout tone="warning" title={openCount > 0 ? `Tienes ${countOf(openCount, "observación", "observaciones")} por responder` : "Todas las observaciones están respondidas"}>
          Corrige la matriz donde corresponda, responde cada observación y luego usa «Reenviar a revisión».
        </Callout>
      )}
      {workspace.observations.length === 0 ? (
        <EmptyState title="Sin observaciones" description={mode.canObserve ? "Observa una fila desde la matriz (botón «Observar») o registra una observación general." : "Cuando la revisión registre observaciones, aparecerán aquí con su respuesta."} />
      ) : groups.map((group) => {
        const items = workspace.observations.filter((item) => item.status === group.key)
        if (items.length === 0) return null
        return (
          <details key={group.key} open={group.key !== "resolved"} className="space-y-2">
            <summary className="cursor-pointer text-sm font-semibold">{group.title} ({items.length})</summary>
            <div className="mt-2 space-y-2">{items.map((item) => <ObservationItem key={item.id} observation={item} mode={mode} onOpenEntry={onOpenEntry} onChanged={() => router.refresh()} />)}</div>
          </details>
        )
      })}
      {mode.canObserve && (
        <div className="space-y-2 rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <p className="text-sm font-medium">Observación general</p>
          <Textarea aria-label="Observación general" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Algo que no corresponde a una fila en particular (antecedentes, participación, cobertura)." />
          <Button size="sm" disabled={operation.pending || body.trim().length < 5} onClick={() => operation.run(() => addMiperObservationAction({ matrixId: workspace.matrix.id, entryId: null, body }), () => setBody(""))}>Registrar observación general</Button>
        </div>
      )}
    </section>
  )
}

/** «Preparación para enviar»: los bloqueos del validador del servidor, agrupados por dónde se corrigen. */
function PreparationSection({ blocking, rows, onOpenEntry, onOpenFicha }: {
  blocking: readonly CompletenessIssue[]
  rows: readonly MiperEntrySnapshot[]
  onOpenEntry: (entryId: string, step?: EditorStep) => void
  onOpenFicha?: () => void
}) {
  return (
    <section aria-labelledby="review-preparation-title" className="space-y-3 border-b border-[var(--color-border)] pb-4">
      <h2 id="review-preparation-title" className="text-base font-semibold">Preparación para enviar</h2>
      {blocking.length === 0 ? <p className="text-sm text-[var(--color-success-ink)]">Sin pendientes: no queda ningún dato obligatorio por completar.</p> : (
        <>
          <p className="text-sm text-[var(--color-text-subtle)]">{countOf(blocking.length, "dato obligatorio pendiente", "datos obligatorios pendientes")}. Cada uno abre el lugar donde se corrige.</p>
          {PREPARATION_GROUPS.map((group) => {
            const items = blocking.filter((issue) => preparationGroupOf(issue) === group.key)
            if (!items.length) return null
            return (
              <section key={group.key} aria-label={`${group.title} (${items.length})`} className="space-y-1">
                <h3 className="text-sm font-semibold">{group.title} ({items.length})</h3>
                <ul className="space-y-1 text-sm">
                  {items.slice(0, 5).map((issue) => {
                    const entry = issue.entryId ? rows.find((row) => row.id === issue.entryId) : undefined
                    const label = `${entry ? `Riesgo #${entry.rowNumber}` : group.title}: ${issue.message}`
                    const go = entry ? () => onOpenEntry(entry.id, stepOfField(issue.field)) : onOpenFicha
                    return <li key={`${issue.entryId ?? "documento"}:${issue.field}:${issue.message}`}>{go ? <button type="button" className="text-left text-[var(--color-primary-ink)] underline underline-offset-2" onClick={go}>{label}</button> : label}</li>
                  })}
                  {items.length > 5 && <li className="text-[var(--color-text-subtle)]">y {items.length - 5} más; «Enviar a revisión» muestra la lista completa.</li>}
                </ul>
              </section>
            )
          })}
        </>
      )}
    </section>
  )
}

const REVIEW_STEPS = ["Elaboración", "Revisión técnica", "Aprobación Legal/RRHH", "Vigente"] as const

/** Etapa actual en el recorrido de `REVIEW_STEPS` (presentación de `states.ts`); `null` en un documento histórico. */
function currentStageOf(workspace: MiperWorkspace): number | null {
  const { matrix } = workspace
  if (matrix.status === "superseded" || matrix.isLegacy) return null
  const stage = REVIEW_STAGE_FOR_STATE[matrix.reviewState as MiperReviewState]
  if (stage === "technical") return 1
  if (stage === "legal_rrhh") return 2
  return matrix.status === "published" && matrix.reviewState === "none" && !workspace.pendingDiff.hasChanges ? 3 : 0
}

/** «Estado de revisión»: etapa, responsable, versión vigente, ronda abierta y qué le toca a quien mira. */
function ReviewStateSection({ workspace, mode, currentStage }: { workspace: MiperWorkspace; mode: WorkspaceMode; currentStage: number | null }) {
  const { matrix, openRound } = workspace
  const reviewing = mode.canReviewTechnical || mode.canApproveLegal
  const stage = REVIEW_STAGE_FOR_STATE[matrix.reviewState as MiperReviewState]
  const latest = workspace.versions[0]
  const historical = currentStage === null
  const steps = REVIEW_STEPS
  const responsibility = stage ? STAGE_LABEL[stage] : currentStage === 0 ? "Prevencionista de la faena" : null
  return (
    <section aria-labelledby="review-state-title" className="space-y-3 border-b border-[var(--color-border)] pb-4">
      <h2 id="review-state-title" className="text-base font-semibold">Estado de revisión</h2>
      <ol aria-label="Etapas de revisión" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {steps.map((label, index) => <li key={label} aria-current={currentStage === index ? "step" : undefined} className={currentStage === index ? "font-semibold text-[var(--color-primary-ink)]" : "text-[var(--color-text-subtle)]"}>{index + 1}. {label}{currentStage === index && <span className="sr-only"> · etapa actual</span>}</li>)}
      </ol>
      {historical ? <p className="text-sm text-[var(--color-text-subtle)]">{mode.readOnlyReason}</p> : <p className="text-sm">{responsibility ? `A cargo de: ${responsibility}.` : "Revisión finalizada."} {matrix.reviewState === "observed" && "Hay observaciones que deben corregirse antes de reenviar."}</p>}
      {matrix.status === "published" && latest && <p className="text-sm"><strong>Versión vigente: v{latest.versionNumber}</strong>, aprobada el {formatDateTime(latest.approvedAt)}.{currentStage !== 3 && " Sigue vigente mientras se revisan los cambios."}</p>}
      {openRound && <div className="space-y-1 text-sm text-[var(--color-text-subtle)]">
        <p><strong className="text-[var(--color-text)]">Ronda {openRound.roundNumber}</strong> · enviada el {formatDateTime(openRound.submittedAt)}{openRound.submittedByName ? ` por ${openRound.submittedByName}` : ""}.</p>
        <p>{reviewing ? "Estás revisando la versión enviada en esta ronda. Los cambios posteriores se revisan en otra ronda." : mode.canEdit ? "La ronda conserva la versión enviada. Los cambios que hagas ahora quedan en el trabajo editable para otra ronda." : "La decisión se toma sobre la versión enviada. El trabajo editable puede incluir cambios posteriores."}</p>
        {!openRound.openedAt && <p>Aún no abierta por la persona revisora.</p>}
      </div>}
      {mode.canEdit && matrix.reviewState === "none" && currentStage === 0 && <p className="text-sm">Completa la ficha, los riesgos y sus medidas. Después usa «Enviar a revisión» en la cabecera.</p>}
      {mode.canReviewTechnical && <p className="text-sm">Revisa los riesgos y las respuestas. Luego aprueba la revisión técnica o devuelve con observaciones desde la cabecera.</p>}
      {mode.canApproveLegal && <p className="text-sm">Decide sobre la versión revisada técnicamente: aprobar y sellar o solicitar correcciones desde la cabecera.</p>}
    </section>
  )
}
