"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import type { WorkOrderAvailablePart } from "@/lib/services/mantencion/parts/types"
import { formatQty } from "@/lib/utils"

/**
 * «Disponibles para esta OT»: los repuestos que llegaron a la faena y quedaron reservados para la orden. Un chip por
 * repuesto, con lo que queda por tomar («Filtro de aceite · 2 disp.»); sin nada que tomar, el chip no se puede
 * usar. Es la misma ayuda que la app del mecánico da sobre «Agregar repuesto»; el texto libre sigue como hoy.
 */
export function AvailablePartChips({ available, left, onAdd }: {
  available: readonly WorkOrderAvailablePart[]
  /** Lo que queda por tomar de cada reserva (id de reserva → cantidad). */
  left: Record<string, number>
  onAdd: (part: WorkOrderAvailablePart) => void
}) {
  const labelId = React.useId()
  if (available.length === 0) return null
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-1.5">
      <p id={labelId} className="text-sm text-[var(--color-text-muted)]">Disponibles para esta OT</p>
      <div className="flex flex-wrap gap-2">
        {available.map((part) => {
          const remaining = left[part.allocationId] ?? part.remaining
          return (
            <Button key={part.allocationId} type="button" size="sm" variant="secondary" disabled={remaining <= 0} onClick={() => onAdd(part)}>
              {part.name} · {formatQty(remaining)} disp.
            </Button>
          )
        })}
      </div>
    </div>
  )
}
