"use client"

import * as React from "react"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { runStatusBadgeVariant } from "@/lib/prevention/inspections"
import { inspectionTaskStatusLabel } from "@/lib/prevention/inspection-list-query"
import { clearInspectionDraftsOfRun } from "@/lib/prevention/inspection-draft-storage"
import { cancelInspectionRunAction, reopenInspectionRunAction } from "../../actions"
import { CompleteDialog } from "./complete-dialog"
import { ReasonDialog } from "./run-detail-controls"
import { ReviewDialog } from "./review-dialog"
import { RunSaveStatus } from "./run-status"
import type { RunViewModel } from "./run-view-types"

export type RunActionBarModel = Pick<
  RunViewModel,
  | "run" | "items" | "requiredItems" | "answeredRequired" | "answeredCount"
  | "editable" | "canExecute" | "canReview" | "canManage" | "canCurrentUserReview"
  | "currentUserId" | "assignees" | "findings"
  | "coords" | "channel" | "geo" | "completion" | "jumpToItem"
>

/**
 * La fila de estado y acciones de escritorio: badge y avance a la izquierda;
 * a la derecha, lo que se puede hacer según el modo (capturar ubicación,
 * guardar y declarar ejecutada cuando se edita; revisar cuando está
 * completada; Acta PDF, reabrir y cancelar según estado y permiso).
 *
 * La barra fija del teléfono (`MobileActionBar`) pinta el mismo `RunSaveStatus`
 * con el mismo estado, así que las dos no pueden contradecirse.
 */
export function RunActionBar({ model }: { model: RunActionBarModel }) {
  const {
    run, items, requiredItems, answeredRequired, answeredCount, editable, canExecute, canReview, canManage,
    canCurrentUserReview, currentUserId, assignees, findings, coords, channel, geo, completion, jumpToItem,
  } = model
  const version = channel.version

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <MetaBadge meta={{ label: `${inspectionTaskStatusLabel(run.status)}`, variant: runStatusBadgeVariant(run.status) }} />
        <span className="text-sm text-[var(--color-text-subtle)]">
          {requiredItems.length > 0 && `${answeredRequired} de ${requiredItems.length} obligatorios · `}
          {answeredCount} de {items.length} {requiredItems.length > 0 ? "totales" : "respondidos"}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {editable && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={channel.locked || geo.state === "pending"}
            onClick={geo.capture}
          >
            {coords ? `Ubicación ${coords.lat}, ${coords.lon}` : geo.state === "pending" ? "Ubicando…" : "Capturar ubicación"}
          </Button>
        )}
        {editable && (
          <>
            {/* «Guardar» nunca se deshabilita por filas con problemas: guarda lo
                que sí se puede y deja retenidas las demás (P1-1). */}
            <Button className="hidden md:inline-flex" type="button" size="sm" variant="secondary" disabled={channel.saving || channel.locked} onClick={() => void channel.save()}>
              {channel.saving ? "Guardando…" : "Guardar respuestas"}
            </Button>
            {/* INS-02: el autoguardado necesita decir en qué estado está, o
                quien ejecuta no sabe si puede irse de la pantalla. La barra
                del teléfono pinta este mismo estado (P1-7). */}
            <RunSaveStatus state={channel.captureState} className="hidden self-center md:inline" />
          </>
        )}
        {/* Función #3: el acta de LA inspección. El export Excel es agregado
            y en fiscalización se pide esta. */}
        {["completed", "reviewed"].includes(run.status) && (
          <Button asChild size="sm" variant="secondary">
            <a href={`/prevencion/inspecciones/${run.id}/print`} target="_blank" rel="noreferrer">Acta PDF</a>
          </Button>
        )}
        {editable && (
          <span className="hidden md:inline-flex">
            <CompleteDialog
              run={run}
              completion={completion}
              held={channel.held}
              online={channel.online}
              saving={channel.saving}
              disabled={channel.locked}
              onComplete={channel.complete}
              onQueueClose={channel.queueClose}
              onJump={jumpToItem}
            />
          </span>
        )}
        {canCurrentUserReview && (
          <span className="hidden md:inline-flex"><ReviewDialog run={run} findings={findings} currentUserId={currentUserId} version={version} assignees={assignees} canExecute={canExecute} /></span>
        )}
        {/* A-05: rectificar una ejecución declarada por error. Antes no
            existía camino de vuelta y el dato quedaba firmado. */}
        {canReview && ["completed", "reviewed"].includes(run.status) && (
          <ReasonDialog
            trigger="Reabrir para rectificar"
            title={`Reabrir ${run.code}`}
            description="Vuelve la inspección a ejecución: borra el cumplimiento calculado y los hallazgos que no tengan CAPA. Los que ya tienen acción correctiva se conservan."
            action={(reason) => reopenInspectionRunAction({ runId: run.id, expectedVersion: version, reason })}
            onDone={channel.applyVersion}
            confirmVariant="warning"
            reasonLabel="Motivo de la rectificación"
            successMessage="Inspección reabierta."
          />
        )}
        {/* A-04: cancelar una planificada que ya no corresponde. */}
        {canManage && ["planned", "in_progress", "completed"].includes(run.status) && (
          <ReasonDialog
            trigger="Cancelar inspección"
            title={`Cancelar ${run.code}`}
            description="La inspección deja de estar pendiente y sale de la bandeja. No se puede deshacer."
            action={(reason) => cancelInspectionRunAction({ runId: run.id, expectedVersion: version, reason })}
            onDone={(result) => {
              channel.applyVersion(result)
              // Cancelada: lo que quedó sin enviar en el dispositivo ya no aplica, en ninguna pestaña.
              clearInspectionDraftsOfRun(run.id)
            }}
            variant="ghost-danger"
            reasonLabel="Motivo de la cancelación"
            successMessage="Inspección cancelada."
          />
        )}
      </div>
    </div>
  )
}
