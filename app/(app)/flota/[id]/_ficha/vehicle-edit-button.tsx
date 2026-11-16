"use client"

import * as React from "react"
import { PencilSimple } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import { VehicleForm } from "@/app/(app)/combustibles/vehiculos/vehicle-form"
import { loadVehicleEditAction, type VehicleEditPayload } from "./edit-vehicle-action"

/**
 * «Editar vehículo» de la cabecera de la ficha: el formulario del padrón en una hoja lateral,
 * el único lugar donde se edita la identidad del vehículo (crítica 2026-11-15, paso 4b). Pide
 * los datos al abrir; mientras llegan, el botón dice que está abriendo. Al guardar, la acción
 * del padrón refresca las pestañas de la ficha.
 */
export function VehicleEditButton({ vehicleId }: { vehicleId: string }) {
  const [payload, setPayload] = React.useState<VehicleEditPayload | null>(null)
  const [open, setOpen] = React.useState(false)
  const { pending, run } = useOperation()
  // Cada apertura monta un formulario nuevo: lo que se escribió y se canceló no reaparece.
  const [openCount, setOpenCount] = React.useState(0)

  function openEditor() {
    run(
      async () => {
        const result = await loadVehicleEditAction(vehicleId)
        if (!result.ok) return result
        setPayload(result.data)
        setOpenCount((count) => count + 1)
        setOpen(true)
        return { ok: true }
      },
      () => undefined,
      (failure) => toast.error(failure.message ?? "No se pudo abrir el formulario. Inténtalo de nuevo."),
    )
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={openEditor} disabled={pending} aria-busy={pending || undefined}>
        <PencilSimple size={14} aria-hidden />
        {pending ? "Abriendo…" : "Editar vehículo"}
      </Button>
      {payload ? (
        <VehicleForm
          key={openCount}
          open={open}
          onClose={() => setOpen(false)}
          {...payload.catalogs}
          editVehicle={payload.vehicle}
          maintenanceBrands={payload.maintenanceBrands}
        />
      ) : null}
    </>
  )
}
