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

export interface ReturnPanelStockOption {
  worksiteId:    string
  worksiteName:  string
  productId:     string
  productName:   string
  productSku:    string | null
  unitOfMeasure: string
}

interface WorksiteOption {
  id: string
  name: string
}

export function ReturnPanel({
  products,
  worksites,
}: {
  products: ReturnPanelStockOption[]
  worksites: WorksiteOption[]
}) {
  const [worksiteId, setWorksiteId] = React.useState<string>(worksites[0]?.id ?? "")
  const [productId,  setProductId]  = React.useState<string>("")
  const formRef = React.useRef<HTMLFormElement>(null)

  const [state, action, pending] = useActionState<ActionState, FormData>(returnStockAction, INITIAL_STATE)

  React.useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
      formRef.current?.reset()
      setWorksiteId(worksites[0]?.id ?? "")
      setProductId("")
    } else if (state.ok === false && state.message && state !== INITIAL_STATE) {
      toast.error(state.message)
    }
  }, [state, worksites])

  const availableProducts = worksiteId
    ? products.filter((p) => p.worksiteId === worksiteId)
    : []

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
        <input type="hidden" name="worksiteId" value={worksiteId} />
        <input type="hidden" name="productId"  value={productId} />

        <Field label="Faena" htmlFor="returnWorksiteId" required error={state.fieldErrors?.worksiteId?.[0]}>
          <Select value={worksiteId} onValueChange={(v) => { setWorksiteId(v); setProductId("") }}>
            <SelectTrigger id="returnWorksiteId" error={!!state.fieldErrors?.worksiteId}>
              <SelectValue placeholder="Selecciona faena" />
            </SelectTrigger>
            <SelectContent>
              {worksites.map((w) => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Producto" htmlFor="returnProductId" required error={state.fieldErrors?.productId?.[0]}>
          <Select searchable value={productId} onValueChange={setProductId} disabled={!worksiteId}>
            <SelectTrigger id="returnProductId" error={!!state.fieldErrors?.productId}>
              <SelectValue placeholder={worksiteId ? "Selecciona producto" : "Elige faena primero"} />
            </SelectTrigger>
            <SelectContent>
              {availableProducts.map((p) => (
                <SelectItem key={p.productId} value={p.productId}>
                  {p.productName}
                </SelectItem>
              ))}
              {availableProducts.length === 0 && worksiteId && (
                <SelectItem value="__none__" disabled>Sin productos en esta faena</SelectItem>
              )}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label="Cantidad a devolver"
          htmlFor="returnQuantity"
          required
          error={state.fieldErrors?.quantity?.[0]}
        >
          <Input
            id="returnQuantity"
            type="number"
            name="quantity"
            step="0.01"
            min="0.01"
            placeholder="0"
            disabled={!productId}
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
            disabled={!productId}
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
            label="Registrar devolución"
            loadingLabel="Guardando..."
            variant="primary"
            disabled={!worksiteId || !productId || pending}
          />
        </div>
      </form>
    </section>
  )
}
