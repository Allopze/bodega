"use client"

import * as React from "react"
import { MetaBadge } from "@/components/states/state-badge"
import { runStatusBadgeVariant } from "@/lib/prevention/inspections"
import { inspectionTaskStatusLabel } from "@/lib/prevention/inspection-list-query"
import { ReviewDialog } from "./review-dialog"
import { progressText } from "./run-progress"
import type { RunViewModel } from "./run-view-types"

export type RunActionBarModel = Pick<
  RunViewModel,
  | "run" | "items" | "requiredItems" | "answeredRequired" | "answeredCount"
  | "canExecute" | "canCurrentUserReview" | "currentUserId" | "assignees" | "findings" | "channel"
>

/**
 * La fila de estado y acciones del modo lectura: badge y avance a la izquierda y,
 * si la inspección está pendiente de revisión y quien mira puede cerrarla,
 * «Revisar y cerrar». La captura tiene su propia cabecera (`RunWorkHeader`).
 *
 * Acta PDF, Reabrir para rectificar y Cancelar inspección ya no están aquí:
 * son del registro entero y viven en el encabezado de la página
 * (`RunRecordActions`, en los dos modos).
 */
export function RunActionBar({ model }: { model: RunActionBarModel }) {
  const { run, canExecute, canCurrentUserReview, currentUserId, assignees, findings, channel } = model
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <MetaBadge meta={{ label: `${inspectionTaskStatusLabel(run.status)}`, variant: runStatusBadgeVariant(run.status) }} />
        <span className="text-sm text-[var(--color-text-subtle)]">{progressText(model)}</span>
      </div>
      {canCurrentUserReview && (
        <span className="hidden md:inline-flex"><ReviewDialog run={run} findings={findings} currentUserId={currentUserId} version={channel.version} assignees={assignees} canExecute={canExecute} /></span>
      )}
    </div>
  )
}
