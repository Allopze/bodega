"use client"

import * as React from "react"
import { DeviationsPanel, ParticipantsPanel, PreventiveActionsPanel } from "./deviation-panels"
import type { RunViewModel } from "./run-view-types"

export type RunDeviationRecordsModel = Pick<
  RunViewModel,
  | "run" | "findings" | "participants" | "assignees" | "deviationCatalog" | "recordsDeviations" | "recordsPreventiveActions"
  | "isUnplannedInspection" | "editable" | "canExecute" | "inspectionDraft" | "channel"
>

/**
 * Lo que registran los instrumentos que no puntúan ítems: participantes (en las
 * no planificadas), desviaciones y acciones preventivas. La gravedad la trae el
 * catálogo, así que el plazo de la acción correctiva no depende de quien está
 * en terreno. Cada panel sabe si se edita; en lectura son la misma lista sin
 * controles. Sin ninguno de los dos modos de registro no pinta nada.
 */
export function RunDeviationRecords({ model }: { model: RunDeviationRecordsModel }) {
  const {
    run, findings, participants, assignees, deviationCatalog, recordsDeviations, recordsPreventiveActions,
    isUnplannedInspection, editable, canExecute, inspectionDraft, channel,
  } = model
  return (
    <>
      {/* Los instrumentos que no puntúan ítems registran lo que encontraron. La
          gravedad la trae el catálogo, así que el plazo de la acción correctiva
          no depende de quien está en terreno. */}
      {recordsDeviations && (
        <>
        {isUnplannedInspection && (
          <ParticipantsPanel
            runId={run.id}
            participants={participants}
            editable={editable && canExecute}
            initialRows={inspectionDraft.participants.initialRows}
            onRowsChange={inspectionDraft.participants.onRowsChange}
          />
        )}
        <DeviationsPanel
          runId={run.id}
          editable={editable}
          canExecute={canExecute}
          catalog={deviationCatalog}
          registered={findings.filter((finding) => finding.origin === "deviation")}
          narrative={isUnplannedInspection}
          onVersion={channel.applyVersion}
        />
        </>
      )}
      {recordsPreventiveActions && (
        <PreventiveActionsPanel runId={run.id} actions={findings.filter((finding) => finding.origin === "deviation")} assignees={assignees} editable={editable && canExecute} onVersion={channel.applyVersion} />
      )}
    </>
  )
}
