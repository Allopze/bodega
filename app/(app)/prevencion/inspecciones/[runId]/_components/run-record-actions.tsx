"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { clearInspectionDraftsOfRun } from "@/lib/prevention/inspection-draft-storage"
import { cancelInspectionRunAction, reopenInspectionRunAction } from "../../actions"
import { ReasonDialog } from "./run-detail-controls"
import { publishRunVersion, useLiveRunVersion } from "./run-live-version"
import { recordActionsAvailability } from "./run-view-helpers"

/**
 * Las acciones del registro de una inspección —Acta PDF, Reabrir para
 * rectificar, Cancelar inspección— en los dos modos (captura y lectura). Las
 * monta `page.tsx` en `PageHeader.actions`: son del registro entero y no de la
 * lista de ítems, así que ya no son una barra propia dentro del contenido
 * (regla 5 de AGENTS.md).
 *
 * Es un componente de cliente que sólo recibe datos planos del servidor. La
 * versión con la que se piden reabrir y cancelar es la vigente del canal de
 * guardado (`useLiveRunVersion`), no la de las props, que va un paso atrás
 * mientras un autoguardado está en vuelo.
 */
export function RunRecordActions({ runId, code, status, version, canReview, canManage }: {
  runId: string
  code: string
  status: string
  /** La de las props de la página: sirve de piso hasta que el canal publique una mayor. */
  version: number
  canReview: boolean
  canManage: boolean
}) {
  const liveVersion = useLiveRunVersion(runId, version)
  const available = recordActionsAvailability(status, { canReview, canManage })
  if (!available.pdf && !available.reopen && !available.cancel) return null

  function adoptVersion(result: { data?: Record<string, unknown> }) {
    const next = result.data?.version
    if (typeof next === "number") publishRunVersion(runId, next)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {available.pdf && (
        <Button asChild size="sm" variant="secondary">
          <a href={`/prevencion/inspecciones/${runId}/print`} target="_blank" rel="noreferrer">Acta PDF</a>
        </Button>
      )}
      {/* A-05: antes no existía camino de vuelta y el dato quedaba firmado. */}
      {available.reopen && (
        <ReasonDialog
          trigger="Reabrir para rectificar"
          title={`Reabrir ${code}`}
          description="Vuelve la inspección a ejecución: borra el cumplimiento calculado y los hallazgos que no tengan CAPA. Los que ya tienen acción correctiva se conservan."
          action={(reason) => reopenInspectionRunAction({ runId, expectedVersion: liveVersion, reason })}
          onDone={adoptVersion}
          confirmVariant="warning"
          reasonLabel="Motivo de la rectificación"
          successMessage="Inspección reabierta."
        />
      )}
      {/* A-04: cancelar una planificada que ya no corresponde. */}
      {available.cancel && (
        <ReasonDialog
          trigger="Cancelar inspección"
          title={`Cancelar ${code}`}
          description="La inspección deja de estar pendiente y sale de la bandeja. No se puede deshacer."
          action={(reason) => cancelInspectionRunAction({ runId, expectedVersion: liveVersion, reason })}
          onDone={(result) => {
            adoptVersion(result)
            // Cancelada: lo que quedó sin enviar en el dispositivo ya no aplica, en ninguna pestaña.
            clearInspectionDraftsOfRun(runId)
          }}
          variant="ghost-danger"
          reasonLabel="Motivo de la cancelación"
          successMessage="Inspección cancelada."
        />
      )}
    </div>
  )
}
