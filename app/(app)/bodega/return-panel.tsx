"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { Warning, ArrowBendUpLeft } from "@phosphor-icons/react"
import { SubmitButton } from "@/components/admin/submit-button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { returnStockAction } from "./actions"
import type { ActionState } from "@/lib/validation/operations"
import type { WorksiteReturnOption } from "./movement-options"

export function ReturnPanel({
  worksiteId,
  returns,
}: {
  worksiteId: string
  returns: WorksiteReturnOption[]
}) {
  const [deliveryItemId, setDeliveryItemId] = React.useState<string>("")
  const formRef = React.useRef<HTMLFormElement>(null)

  const [state, action, pending] = useActionState<ActionState, FormData>(returnStockAction, INITIAL_STATE)

  React.useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
      formRef.current?.reset()
      setDeliveryItemId("")
    } else if (state.ok === false && state.message && state !== INITIAL_STATE) {
      toast.error(state.message)
    }
  }, [state])

  const selected = returns.find((item) => item.deliveryItemId === deliveryItemId)

  return (
    <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="border-b border-[var(--color-border)] px-5 py-4">
        <h2 className="text-h2 flex items-center gap-2 text-[var(--color-text)]">
          <ArrowBendUpLeft size={16} className="text-[var(--color-text-muted)]" />
          Devolver a stock
        </h2>
        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
          Registrar devolución de EPP
        </p>
      </div>

      <form ref={formRef} action={action} className="flex flex-col gap-4 p-5">
        <input type="hidden" name="deliveryItemId" value={deliveryItemId} />
        <input type="hidden" name="worksiteId" value={worksiteId} />

        <Field label="Entrega a devolver" htmlFor="returnDeliveryItemId" required error={state.fieldErrors?.deliveryItemId?.[0]}>
          <Select searchable value={deliveryItemId} onValueChange={setDeliveryItemId}>
            <SelectTrigger id="returnDeliveryItemId" error={!!state.fieldErrors?.deliveryItemId}>
              <SelectValue placeholder="Selecciona entrega pendiente" />
            </SelectTrigger>
            <SelectContent>
              {returns.map((item) => (
                <SelectItem key={item.deliveryItemId} value={item.deliveryItemId}>
                  {item.productName} · {item.deliveryCode} · saldo {item.remainingQuantity} {item.unitOfMeasure}
                </SelectItem>
              ))}
              {returns.length === 0 && (
                <SelectItem value="__none__" disabled>Sin entregas pendientes en esta faena</SelectItem>
              )}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label="Cantidad a devolver"
          htmlFor="returnQuantity"
          required
          helper={selected ? `Máximo devolvible: ${selected.remainingQuantity} ${selected.unitOfMeasure}` : undefined}
          error={state.fieldErrors?.quantity?.[0]}
        >
          <Input
            id="returnQuantity"
            type="number"
            name="quantity"
            step="0.01"
            min="0.01"
            max={selected ? String(selected.remainingQuantity) : undefined}
            placeholder="0"
            disabled={!deliveryItemId}
            required
            error={!!state.fieldErrors?.quantity}
            className="tabular-nums"
          />
        </Field>

        <Field label="Motivo" htmlFor="returnReason" required error={state.fieldErrors?.reason?.[0]}>
          <Input
            id="returnReason"
            name="reason"
            placeholder="Ej: sobrante de entrega, no utilizado..."
            disabled={!deliveryItemId}
            required
            error={!!state.fieldErrors?.reason}
          />
        </Field>

        <Field label="Notas adicionales" htmlFor="returnNotes" error={state.fieldErrors?.notes?.[0]}>
          <Textarea
            id="returnNotes"
            name="notes"
            rows={2}
            placeholder="Información adicional..."
            disabled={!deliveryItemId}
            error={!!state.fieldErrors?.notes}
          />
        </Field>

        {state.ok === false && state.message && state !== INITIAL_STATE && (
          <p className="text-sm text-[var(--color-danger)] flex items-center gap-1.5">
            <Warning size={14} /> {state.message}
          </p>
        )}

        <div className="flex justify-end pt-2">
          <SubmitButton
            label="Registrar devolución"
            loadingLabel="Guardando..."
            variant="primary"
            disabled={!worksiteId || !deliveryItemId || pending}
          />
        </div>
      </form>
    </section>
  )
}
