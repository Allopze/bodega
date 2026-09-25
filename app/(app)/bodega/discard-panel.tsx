"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { Warning, Trash } from "@phosphor-icons/react"
import { SubmitButton } from "@/components/ui/submit-button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { INITIAL_STATE } from "@/lib/form-state"
import { discardStockAction } from "./actions"
import { formatQty } from "@/lib/utils"
import type { ActionState } from "@/lib/validation/operations"
import type { WorksiteProductOption } from "./movement-options"

/**
 * Baja por desecho.
 *
 * El motor ya sabía registrar `egreso_desecho` (rama propia, validación y
 * locks), pero ninguna pantalla lo emitía: dar de baja EPP dañado obligaba a
 * disfrazarlo de "ajuste" con motivo libre, y el kardex perdía la clasificación
 * que ya sabe rotular.
 */
export function DiscardPanel({
  worksiteId,
  products,
  onDone,
}: {
  worksiteId: string
  products: WorksiteProductOption[]
  /** Se llama cuando el movimiento queda registrado, para cerrar la hoja. */
  onDone?: () => void
}) {
  const [productId, setProductId] = React.useState<string>("")
  const formRef = React.useRef<HTMLFormElement>(null)

  // El aviso y el cierre salen dentro de la acción: la hoja queda montada
  // después de revalidar, así que sin cerrarla seguiría abierta sobre datos
  // viejos (antes la cerraba el remontaje de toda la plataforma).
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await discardStockAction(prev, formData)
    if (result.ok) {
      if (result.message) toast.success(result.message)
      formRef.current?.reset()
      setProductId("")
      onDone?.()
    } else if (result.message) {
      toast.error(result.message)
    }
    return result
  }, INITIAL_STATE)

  const selected = products.find((product) => product.productId === productId)
  const withStock = products.filter((product) => product.quantity > 0)

  return (
    <section className="rounded-[var(--radius-xl)] border border-(--color-border) bg-(--color-surface)">
      <div className="border-b border-(--color-border) px-5 py-4">
        <h2 className="text-h2 flex items-center gap-2 text-(--color-text)">
          <Trash size={16} className="text-(--color-text-muted)" />
          Baja por desecho
        </h2>
        <p className="mt-0.5 text-xs text-(--color-text-muted)">
          Retiro definitivo de EPP dañado, vencido o inservible. Emite folio propio.
        </p>
      </div>

      <form ref={formRef} action={action} className="flex flex-col gap-4 p-5">
        <input type="hidden" name="worksiteId" value={worksiteId} />
        <input type="hidden" name="productId"  value={productId} />

        <Field label="Producto" htmlFor="discardProductId" required error={state.fieldErrors?.productId?.[0]}>
          <Select searchable value={productId} onValueChange={setProductId}>
            <SelectTrigger id="discardProductId" error={!!state.fieldErrors?.productId}>
              <SelectValue placeholder="Selecciona producto" />
            </SelectTrigger>
            <SelectContent>
              {withStock.map((product) => (
                <SelectItem key={product.productId} value={product.productId}>
                  {product.productName}
                </SelectItem>
              ))}
              {withStock.length === 0 && (
                <SelectItem value="__none__" disabled>Sin existencias que dar de baja en esta faena</SelectItem>
              )}
            </SelectContent>
          </Select>
        </Field>

        {selected && (
          <p className="-mt-2 text-xs text-(--color-text-muted)">
            Stock actual:{" "}
            <span className="font-mono font-semibold tabular-nums text-(--color-text)">
              {formatQty(selected.quantity, selected.unitOfMeasure)}
            </span>
          </p>
        )}

        <Field label="Cantidad a dar de baja" htmlFor="discardQuantity" required error={state.fieldErrors?.quantity?.[0]}>
          <Input
            id="discardQuantity"
            type="number"
            name="quantity"
            step="0.01"
            min="0.01"
            max={selected ? String(selected.quantity) : undefined}
            placeholder="0"
            disabled={!productId}
            required
            error={!!state.fieldErrors?.quantity}
            className="tabular-nums"
          />
        </Field>

        <Field label="Motivo" htmlFor="discardReason" required error={state.fieldErrors?.reason?.[0]}>
          <Input
            id="discardReason"
            name="reason"
            placeholder="Ej: dañado en faena, vencido, contaminado..."
            disabled={!productId}
            required
            error={!!state.fieldErrors?.reason}
          />
        </Field>

        <Field label="Notas adicionales" htmlFor="discardNotes" error={state.fieldErrors?.notes?.[0]}>
          <Textarea
            id="discardNotes"
            name="notes"
            rows={2}
            placeholder="Información adicional sobre la baja..."
            disabled={!productId}
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
            label="Registrar baja"
            loadingLabel="Guardando..."
            variant="primary"
            disabled={!worksiteId || !productId || pending}
          />
        </div>
      </form>
    </section>
  )
}
