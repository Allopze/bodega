"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { Warning, ArrowsCounterClockwise } from "@phosphor-icons/react"
import { SubmitButton } from "@/components/ui/submit-button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { INITIAL_STATE } from "@/lib/form-state"
import { adjustStockAction } from "./actions"
import { formatQty, quantityStep } from "@/lib/utils"
import type { ActionState } from "@/lib/validation/operations"
import type { WorksiteProductOption } from "./movement-options"

export function AdjustPanel({
  worksiteId,
  products,
  initialProductId,
  onDone,
}: {
  worksiteId: string
  products: WorksiteProductOption[]
  /** Producto preseleccionado cuando se llega desde la fila de Stock. */
  initialProductId?: string
  /** Se llama cuando el movimiento queda registrado, para cerrar la hoja. */
  onDone?: () => void
}) {
  const [productId, setProductId] = React.useState<string>(
    () => (initialProductId && products.some((product) => product.productId === initialProductId) ? initialProductId : ""),
  )
  const [counted, setCounted] = React.useState("")
  const formRef = React.useRef<HTMLFormElement>(null)

  // El aviso y el cierre salen dentro de la acción: la hoja queda montada
  // después de revalidar, así que sin cerrarla seguiría abierta sobre datos
  // viejos (antes la cerraba el remontaje de toda la plataforma).
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await adjustStockAction(prev, formData)
    if (result.ok) {
      if (result.message) toast.success(result.message)
      formRef.current?.reset()
      setProductId("")
      setCounted("")
      onDone?.()
    } else if (result.message) {
      toast.error(result.message)
    }
    return result
  }, INITIAL_STATE)

  const selected = products.find((product) => product.productId === productId)

  // BOD-04 (auditoría 2026-10-05): se captura la cantidad REAL y el delta sale
  // de restarle el saldo. El servidor lo recalcula contra el saldo bloqueado;
  // esto es sólo la vista previa para que nadie registre a ciegas.
  const rawCounted = counted.trim()
  const countedValue = rawCounted === "" ? null : Number(rawCounted)
  const countedInvalid = countedValue !== null && (!Number.isFinite(countedValue) || countedValue < 0)
  const delta = selected && countedValue !== null && !countedInvalid
    ? Math.round((countedValue - selected.quantity) * 1000) / 1000
    : null
  const cannotSubmit = !selected || countedValue === null || countedInvalid || delta === 0

  return (
    <section className="rounded-[var(--radius-xl)] border border-(--color-border) bg-(--color-surface)">
      <div className="border-b border-(--color-border) px-5 py-4">
        <h2 className="text-h2 flex items-center gap-2 text-(--color-text)">
          <ArrowsCounterClockwise size={16} className="text-(--color-text-muted)" />
          Ajuste de inventario
        </h2>
        <p className="mt-0.5 text-xs text-(--color-text-muted)">
          El número del sistema no cuadra con lo que hay en la estantería
        </p>
      </div>

      <form ref={formRef} action={action} className="flex flex-col gap-4 p-5">
        <input type="hidden" name="worksiteId" value={worksiteId} />
        <input type="hidden" name="productId"  value={productId} />

        <Field label="Producto" htmlFor="adjustProductId" required error={state.fieldErrors?.productId?.[0]}>
          <Select searchable value={productId} onValueChange={setProductId}>
            <SelectTrigger id="adjustProductId" error={!!state.fieldErrors?.productId}>
              <SelectValue placeholder="Selecciona producto" />
            </SelectTrigger>
            <SelectContent>
              {products.map((product) => (
                <SelectItem key={product.productId} value={product.productId}>
                  {product.productName}
                </SelectItem>
              ))}
              {products.length === 0 && (
                <SelectItem value="__none__" disabled>Sin productos en esta faena</SelectItem>
              )}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label="Cantidad real en bodega"
          htmlFor="adjustCountedQuantity"
          required
          error={state.fieldErrors?.countedQuantity?.[0] ?? (countedInvalid ? "Indica una cantidad de 0 o más" : undefined)}
          hint="Lo que hay hoy en la estantería, no la diferencia."
        >
          <Input
            id="adjustCountedQuantity"
            type="number"
            name="countedQuantity"
            step={selected ? quantityStep(selected.unitOfMeasure) : 1}
            min="0"
            placeholder="0"
            value={counted}
            onChange={(event) => setCounted(event.target.value)}
            disabled={!productId}
            required
            error={!!state.fieldErrors?.countedQuantity || countedInvalid}
            className="tabular-nums"
          />
        </Field>

        {/* El saldo actual y el resultado. Sin esto se corregía a ciegas un
            número que la pantalla no mostraba (BOD-04). */}
        {selected && (
          <p aria-live="polite" className="-mt-2 text-sm text-(--color-text-muted)">
            Stock actual{" "}
            <span className="font-mono font-semibold tabular-nums text-(--color-text)">
              {formatQty(selected.quantity)}
            </span>
            {delta !== null && delta !== 0 && (
              <>
                {" → "}
                <span className="font-mono font-semibold tabular-nums text-(--color-text)">{formatQty(countedValue ?? 0)}</span>{" "}
                <span className={delta > 0 ? "font-semibold text-(--color-success-ink)" : "font-semibold text-(--color-danger-ink)"}>
                  ({delta > 0 ? "+" : "−"}{formatQty(Math.abs(delta))}) · se {delta > 0 ? "suman" : "restan"} {formatQty(Math.abs(delta))} {selected.unitOfMeasure}
                </span>
              </>
            )}
            {delta === 0 && <span> · ya coincide, no hay nada que ajustar</span>}
            {delta === null && <span> {selected.unitOfMeasure}</span>}
          </p>
        )}

        <Field
          label="Motivo"
          htmlFor="adjustReason"
          required
          error={state.fieldErrors?.reason?.[0]}
          hint="Usa Ajuste cuando el número del sistema no cuadra con lo que hay. Para una pérdida o un daño, registra una Baja."
        >
          <Input
            id="adjustReason"
            name="reason"
            placeholder="Ej: conteo semanal, error de registro, ingreso sin documentar..."
            disabled={!productId}
            required
            error={!!state.fieldErrors?.reason}
          />
        </Field>

        <Field label="Notas adicionales" htmlFor="adjustNotes" error={state.fieldErrors?.notes?.[0]}>
          <Textarea
            id="adjustNotes"
            name="notes"
            rows={2}
            placeholder="Información adicional sobre el ajuste..."
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
            label="Registrar ajuste"
            loadingLabel="Guardando..."
            variant="primary"
            disabled={!worksiteId || cannotSubmit || pending}
          />
        </div>
      </form>
    </section>
  )
}
