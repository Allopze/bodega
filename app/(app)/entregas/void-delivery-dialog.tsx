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
import type { ActionState } from "@/lib/validation/operations"
import { voidDeliveryAction } from "./actions"

/**
 * Anula una entrega y repone su stock.
 *
 * El motivo es obligatorio y no decorativo: la anulación mueve inventario, y sin
 * una razón escrita el descuadre no se puede reconstruir después. El mismo
 * mínimo lo exige el servicio y un CHECK de la tabla.
 */
export function VoidDeliveryDialog({
  deliveryId,
  deliveryCode,
  workerName,
}: {
  deliveryId: string
  deliveryCode: string
  workerName: string
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [state, action] = useActionState<ActionState, FormData>(voidDeliveryAction, INITIAL_STATE)

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
        aria-label={`Anular entrega ${deliveryCode}`}
      >
        <Prohibit size={12} aria-hidden />
        Anular
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anular entrega {deliveryCode}</DialogTitle>
            <DialogDescription>
              El stock de cada línea vuelve a la bodega de origen, en su misma talla.
              La entrega no se borra: queda marcada como anulada y su comprobante
              sigue disponible.
            </DialogDescription>
          </DialogHeader>

          <form action={action} className="flex flex-col gap-4">
            <input type="hidden" name="deliveryId" value={deliveryId} />

            <p className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
              Entregada a <span className="font-medium text-[var(--color-text)]">{workerName}</span>
            </p>

            <Field
              label="Motivo"
              htmlFor="voidReason"
              required
              helper="Mínimo 10 caracteres. Queda en la auditoría del movimiento."
              error={state.fieldErrors?.reason?.[0]}
            >
              <Textarea
                id="voidReason"
                name="reason"
                rows={3}
                placeholder="Ej: se registró la talla equivocada; la entrega real fue la 42"
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
              <SubmitButton label="Anular entrega" loadingLabel="Anulando…" variant="destructive" />
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
