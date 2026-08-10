"use client"

import * as React from "react"
import { useActionState } from "react"
import { Input } from "@/components/ui/input"
import { SubmitButton } from "@/components/admin/submit-button"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { toast } from "@/lib/toast"
import { recordItemCostAction } from "../actions"
import type { ActionState } from "@/lib/validation/operations"

/**
 * Registro del costo real de una línea que entró a la OC con costo pendiente.
 *
 * Va inline en la tabla de ítems y no en un modal aparte: el dato es uno solo
 * (el monto) y se escribe justo donde se está leyendo la línea.
 */
export function OcItemCostForm({
  purchaseOrderItemId,
  quantity,
  unitOfMeasure,
}: {
  purchaseOrderItemId: string
  quantity: number
  unitOfMeasure: string
}) {
  const [state, action] = useActionState<ActionState, FormData>(recordItemCostAction, INITIAL_STATE)
  const inputId = `cost-${purchaseOrderItemId}`

  React.useEffect(() => {
    if (state === INITIAL_STATE || !state.message) return
    if (state.ok) toast.success(state.message)
    else toast.error(state.message)
  }, [state])

  return (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="purchaseOrderItemId" value={purchaseOrderItemId} />
      <div className="flex flex-col gap-1">
        <label htmlFor={inputId} className="text-[10px] text-(--color-text-subtle)">
          Costo unitario real
        </label>
        <Input
          id={inputId}
          name="unitPrice"
          type="number"
          min="0"
          step="1"
          required
          inputMode="numeric"
          placeholder="0"
          className="h-7 w-32 text-sm tabular-nums"
        />
      </div>
      <SubmitButton label="Registrar costo" loadingLabel="Registrando..." variant="secondary" size="sm" />
      <p className="w-full text-[11px] text-(--color-text-subtle)">
        Se multiplicará por {quantity} {unitOfMeasure} y actualizará los totales de la orden.
      </p>
    </form>
  )
}
