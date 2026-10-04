"use client"

import * as React from "react"
import { MetaBadge } from "@/components/states/state-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { progressPercent, type ProgramProgress } from "@/lib/prevention/miper/progress"
import { canExecuteProgramAction, type WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import type { ProgramActionView, ProgramOccurrenceView } from "@/lib/services/miper/program-queries"
import { countOf, formatDate } from "@/lib/utils"
import { occurrenceBadge } from "./program-badges"
import { ProgramActionDialog, SCHEDULE_KIND_LABEL } from "./program-action-dialog"
import { WorkspaceLink } from "./workspace-nav"

export const ratioLabel = (progress: ProgramProgress) =>
  progress.ratio === null ? "Sin ejecuciones programadas" : `${progressPercent(progress)}% realizado`

/** Avance derivado: realizadas, pendientes, incumplidas, vencidas y el cociente. Nada editable. */
export function ActionProgress({ progress }: { progress: ProgramProgress }) {
  return (
    <div className="min-w-40 space-y-1">
      <Progress
        value={progress.done}
        max={progress.planned === 0 ? 1 : progress.planned}
        size="sm"
        label={`Avance: ${progress.done} de ${progress.planned} ejecuciones realizadas`}
      />
      <p className="text-xs tabular-nums">
        {progress.done}/{progress.planned} · {ratioLabel(progress)}
      </p>
      <p className="text-xs text-[var(--color-text-subtle)]">
        {countOf(progress.pending, "pendiente")} · {countOf(progress.failed, "incumplida")} · {countOf(progress.overdue, "vencida")}
      </p>
    </div>
  )
}

/** La próxima ocurrencia por registrar: la pendiente de menor vencimiento. */
export function nextPendingOccurrence(action: ProgramActionView): ProgramOccurrenceView | null {
  let next: ProgramOccurrenceView | null = null
  for (const occurrence of action.occurrences) {
    if (occurrence.outcome !== "pending") continue
    if (next === null || occurrence.dueOn < next.dueOn) next = occurrence
  }
  return next
}

/**
 * Una actividad del programa como tarjeta (patrón de las obligaciones del PDTP):
 * un `article` nombrado por su «Actividad N° n», con lo que importa de un
 * vistazo —responsable, frecuencia, próxima ocurrencia y avance— y las
 * acciones. El detalle completo vive en `?actividad=` (`WorkspaceLink`).
 */
export function ProgramActionCard({
  action, matrixId, mode, userId, users, processes, defaultLocationLabel, today, detailHref, onRegister, onRetire,
}: {
  action: ProgramActionView
  matrixId: string
  mode: WorkspaceMode
  userId: string
  users: Array<{ id: string; name: string }>
  processes: Array<{ id: string; name: string }>
  defaultLocationLabel: string | null
  today: string
  detailHref: string
  onRegister: (occurrence: ProgramOccurrenceView) => void
  onRetire: () => void
}) {
  const headingId = `programa-actividad-${action.id}`
  const retired = action.status === "retired"
  const next = nextPendingOccurrence(action)
  const canExecute = canExecuteProgramAction(mode, { userId, responsibleUserId: action.responsibleUserId })
  const canRegister = next !== null && canExecute && action.status === "active" && next.outcome !== "superseded"
  return (
    <article aria-labelledby={headingId} className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_15rem_auto] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {retired && <Badge variant="outline">Retirada</Badge>}
          {action.processName && <span className="text-xs text-[var(--color-text-subtle)]">{action.processName}</span>}
        </div>
        <h2 id={headingId} className="mt-1 text-sm font-semibold text-[var(--color-text)]">{action.description}</h2>
        <p className="mt-1 text-xs text-[var(--color-text-subtle)]">Actividad N° {action.actionNumber}</p>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          {action.responsibleName ?? "Sin responsable"} · {SCHEDULE_KIND_LABEL[action.scheduleKind]}
          {action.controls.length > 0 ? ` · Riesgos ${action.controls.map((control) => control.rowNumber).join(", ")} del MIPER` : " · Sin medidas del MIPER vinculadas"}
        </p>
        {retired && <p className="mt-1 text-xs text-[var(--color-text-subtle)]">Motivo del retiro: {action.retiredReason}</p>}
      </div>
      <div className="space-y-2">
        {retired ? null : next ? (
          <div>
            <p className="text-xs text-[var(--color-text-muted)]">Próxima ejecución</p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <span>{formatDate(next.dueOn)}</span>
              <MetaBadge meta={occurrenceBadge(next, today)} />
            </p>
          </div>
        ) : (
          <p className="text-xs text-[var(--color-text-subtle)]">Sin ejecuciones pendientes</p>
        )}
        <ActionProgress progress={action.progress} />
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {!retired && canRegister && next && (
          <Button type="button" size="sm" onClick={() => onRegister(next)}>
            Registrar la ejecución del {formatDate(next.dueOn)}
          </Button>
        )}
        <Button asChild size="sm" variant="secondary">
          <WorkspaceLink href={detailHref} aria-label={`Abrir el detalle de la actividad N° ${action.actionNumber}`}>Abrir el detalle</WorkspaceLink>
        </Button>
        {mode.canEdit && !retired && (
          <ProgramActionDialog
            matrixId={matrixId}
            processes={processes}
            users={users}
            action={action}
            defaultLocationLabel={defaultLocationLabel}
            trigger={<Button type="button" size="sm" variant="ghost" aria-label={`Editar la actividad N° ${action.actionNumber}`}>Editar</Button>}
          />
        )}
        {mode.canEdit && !retired && (
          <Button type="button" size="sm" variant="ghost" aria-label={`Retirar la actividad N° ${action.actionNumber}`} onClick={onRetire}>
            Retirar
          </Button>
        )}
      </div>
    </article>
  )
}
