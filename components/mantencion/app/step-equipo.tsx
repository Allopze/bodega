"use client"

import type { Dispatch } from "react"
import type { FlowAction } from "@/lib/mantencion/client/flow"
import type { FlowDraft } from "@/lib/mantencion/client/flow-types"
import { EquipmentPicker } from "./equipment-picker"
import { FieldError } from "./ui"

/** Paso 1: elegir el equipo. Vencidos y próximos primero; sólo equipos del inventario. */
export function StepEquipo({ draft, dispatch }: { draft: FlowDraft; dispatch: Dispatch<FlowAction> }) {
  return (
    <>
      <h2 className="h2">¿Qué equipo vas a mantener?</h2>
      {/* El error va arriba y no bajo la lista: con 40 equipos, el desplazamiento al primer error lo dejaba al fondo. */}
      <FieldError message={draft.errors.vehicle} />
      <EquipmentPicker
        scope={draft.scope}
        query={draft.query}
        selectedId={draft.vehicleId}
        onScope={(scope) => dispatch({ type: "patch", patch: { scope } })}
        onQuery={(query) => dispatch({ type: "patch", patch: { query } })}
        onPick={(row) => dispatch({ type: "pickEquipment", vehicleId: row.eq.id, schedule: row.schedule })}
      />
    </>
  )
}
