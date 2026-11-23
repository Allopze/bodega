"use client"

import { useState, type Dispatch } from "react"
import { releasePhoto } from "@/lib/mantencion/client/drafts"
import type { FleetRow } from "@/lib/mantencion/client/fleet-view"
import { photosLostOnPick, type FlowAction } from "@/lib/mantencion/client/flow"
import type { FlowDraft } from "@/lib/mantencion/client/flow-types"
import { useAppData } from "./app-context"
import { ConfirmDialog } from "./dialog"
import { EquipmentPicker } from "./equipment-picker"
import { FieldError } from "./ui"

/**
 * Paso 1: elegir el equipo. Vencidos y próximos primero; sólo equipos del inventario.
 *
 * Este es el único camino que cambia el equipo de un borrador (el «Cambiar» de Revisar y el «Cambiar equipo» de la
 * lectura sólo llevan hasta aquí). Las fotos ya tomadas llevan el equipo anterior quemado en los píxeles: si las hay,
 * el cambio se confirma y las descarta; sin fotos, es directo.
 */
export function StepEquipo({ draft, dispatch }: { draft: FlowDraft; dispatch: Dispatch<FlowAction> }) {
  const { rows } = useAppData()
  const [pending, setPending] = useState<{ row: FleetRow; photoIds: string[] } | null>(null)
  const previousCode = rows.find((entry) => entry.eq.id === draft.vehicleId)?.eq.code ?? null

  const pick = (row: FleetRow) => {
    const photoIds = photosLostOnPick(draft, row.eq.id)
    if (photoIds.length > 0) { setPending({ row, photoIds }); return }
    dispatch({ type: "pickEquipment", vehicleId: row.eq.id, schedule: row.schedule })
  }
  const confirm = () => {
    if (!pending) return
    // Primero el borrador deja de referenciarlas y después se sueltan los blobs: la misma vía que «Quitar».
    dispatch({ type: "pickEquipment", vehicleId: pending.row.eq.id, schedule: pending.row.schedule })
    for (const id of pending.photoIds) void releasePhoto(id)
    setPending(null)
  }

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
        onPick={pick}
      />
      {pending ? (
        <ConfirmDialog
          title="¿Cambiar de equipo?"
          confirmLabel="Cambiar y descartar"
          cancelLabel="Dejar el equipo"
          danger
          onCancel={() => setPending(null)}
          onConfirm={confirm}
        >
          <p>
            Cambiar de equipo descarta {pending.photoIds.length === 1 ? "la foto" : `las ${pending.photoIds.length} fotos`}{" "}
            ({pending.photoIds.length === 1 ? "lleva" : "llevan"} el sello de {previousCode ?? "el equipo anterior"}). Tendrás que sacarlas de nuevo con {pending.row.eq.code}.
          </p>
        </ConfirmDialog>
      ) : null}
    </>
  )
}
