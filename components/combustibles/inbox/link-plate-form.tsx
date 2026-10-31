"use client"

import { useId, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Combobox } from "@/components/ui/combobox"
import { Field } from "@/components/ui/field"
import { linkInboxPlateAction } from "@/app/(app)/combustibles/revisar/actions"
import type { FuelInboxVehicleOption } from "@/lib/combustibles/inbox/detail-types"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"

/**
 * Vincula una patente de un reporte de tarjeta a un equipo de la misma faena.
 * Sus litros pasan a ese equipo y las próximas actualizaciones de la tarjeta usan
 * el mismo vínculo (lo guarda `linkConsumptionPlateAction`).
 */
export function LinkPlateForm({ batchId, plate, options, onDone }: { batchId: string; plate: string; options: FuelInboxVehicleOption[]; onDone?: () => void }) {
  const router = useRouter()
  const fieldId = useId()
  const [vehicleId, setVehicleId] = useState("")
  const { pending, message, run } = useOperation()

  function submit() {
    if (!vehicleId) return
    run(
      () => linkInboxPlateAction({ batchId, plate, vehicleId }),
      (result) => {
        toast.success(result.message ?? "Patente vinculada")
        setVehicleId("")
        router.refresh()
        onDone?.()
      },
    )
  }

  if (options.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">No hay equipos activos en esta faena a los que vincular la patente. Crea la ficha del equipo en Catálogos de flota y vuelve.</p>
  }

  return (
    <div className="space-y-3">
      <Field label="Equipo" htmlFor={fieldId} required helper="Sus litros pasan a este equipo, y las próximas actualizaciones de la tarjeta usarán la misma asociación.">
        <Combobox id={fieldId} options={options} value={vehicleId} onChange={setVehicleId} placeholder="Busca un equipo por código o patente…" disabled={pending} />
      </Field>
      {message ? <p role="alert" className="text-sm text-[var(--color-danger-ink)]">{message}</p> : null}
      <div className="flex justify-end">
        <Button type="button" variant="primary" onClick={submit} loading={pending} disabled={pending || !vehicleId}>
          Vincular
        </Button>
      </div>
    </div>
  )
}
