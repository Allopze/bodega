"use client"

import * as React from "react"
import { useActionState } from "react"
import { useRouter } from "next/navigation"
import { Prohibit, Warning } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"
import { INITIAL_STATE } from "@/lib/form-state"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { SubmitButton } from "@/components/ui/submit-button"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import type { ActionState } from "@/lib/validation/masters"
import { voidMaintenanceAction } from "./actions"

/**
 * Anula una mantención mal ingresada.
 *
 * A diferencia de anular una entrega, no hay stock ni estado del activo que
 * reponer: `createMaintenance` nunca toca `it_assets`. Anular solo saca la
 * fila de los agregados de costo (ranking por activo, gasto mensual, reporte
 * de costo de reparación); la mantención sigue visible, tachada, en la lista.
 * El motivo es obligatorio y del mismo mínimo que exige el CHECK de BD.
 */
export function VoidMaintenanceDialog({
  maintenanceId,
  assetCode,
  date,
  cost,
}: {
  maintenanceId: string
  assetCode: string
  date: string
  cost: number
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [state, action] = useActionState<ActionState, FormData>(voidMaintenanceAction, INITIAL_STATE)

  React.useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
      setOpen(false)
      router.refresh()
    } else if (state.ok === false && state.message && state !== INITIAL_STATE) {
      toast.error(state.message)
    }
  }, [router, state])

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1 text-[var(--color-danger)] hover:text-[var(--color-danger)]"
        onClick={() => setOpen(true)}
        aria-label={`Anular mantención de ${assetCode}`}
      >
        <Prohibit size={12} aria-hidden />
        Anular
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anular mantención de {assetCode}</DialogTitle>
            <DialogDescription>
              La mantención no se borra: queda marcada como anulada y deja de contar
              en el costo acumulado del equipo, en el gasto mensual y en el reporte
              de costo de reparación.
            </DialogDescription>
          </DialogHeader>

          <form action={action} className="flex flex-col gap-4">
            <input type="hidden" name="id" value={maintenanceId} />

            <p className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
              Registrada el <span className="font-medium text-[var(--color-text)]">{date}</span>, costo {cost.toLocaleString("es-CL")}
            </p>

            <Field
              label="Motivo"
              htmlFor="voidMaintenanceReason"
              required
              helper="Mínimo 10 caracteres. Queda en la línea de tiempo del activo."
              error={state.fieldErrors?.reason?.[0]}
            >
              <Textarea
                id="voidMaintenanceReason"
                name="reason"
                rows={3}
                placeholder="Ej: se registró en el equipo equivocado; la mantención real fue en TI-NB-0042"
                error={!!state.fieldErrors?.reason}
              />
            </Field>

            {state.ok === false && state.message && state !== INITIAL_STATE && (
              <p className="flex items-center gap-1.5 text-sm text-[var(--color-danger)]">
                <Warning size={15} /> {state.message}
              </p>
            )}

            <div className="flex justify-end gap-2 border-t border-[var(--color-border)] pt-4">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
              <SubmitButton label="Anular mantención" loadingLabel="Anulando…" variant="destructive" />
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
