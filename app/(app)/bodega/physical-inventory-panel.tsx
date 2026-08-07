"use client"

import * as React from "react"
import { useActionState } from "react"
import { ClipboardText, Warning } from "@phosphor-icons/react"
import { SubmitButton } from "@/components/admin/submit-button"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/lib/toast"
import type { ActionState } from "@/lib/validation/operations"
import { closePhysicalInventoryCountAction } from "./actions"

export interface PhysicalInventoryStockOption {
  worksiteId: string
  worksiteName: string
  productId: string
  productName: string
  productSku: string | null
  quantity: number
  unitOfMeasure: string
}

interface WorksiteOption {
  id: string
  name: string
}

export function PhysicalInventoryPanel({
  products,
  worksites,
}: {
  products: PhysicalInventoryStockOption[]
  worksites: WorksiteOption[]
}) {
  const [worksiteId, setWorksiteId] = React.useState<string>(worksites[0]?.id ?? "")
  const formRef = React.useRef<HTMLFormElement>(null)
  const [state, action, pending] = useActionState<ActionState, FormData>(closePhysicalInventoryCountAction, INITIAL_STATE)

  React.useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
      formRef.current?.reset()
    } else if (state.ok === false && state.message && state !== INITIAL_STATE) {
      toast.error(state.message)
    }
  }, [state])

  const visibleProducts = worksiteId
    ? products.filter((product) => product.worksiteId === worksiteId)
    : []

  return (
    <section className="rounded-[var(--radius-xl)] border border-(--color-border) bg-(--color-surface)">
      <div className="border-b border-(--color-border) px-5 py-4">
        <h2 className="text-h2 flex items-center gap-2 text-(--color-text)">
          <ClipboardText size={16} className="text-(--color-text-muted)" />
          Conteo fisico
        </h2>
        <p className="mt-0.5 text-xs text-(--color-text-muted)">
          Cierre formal con ajustes automaticos por diferencia
        </p>
      </div>

      <form ref={formRef} action={action} className="flex flex-col gap-4 p-5">
        <input type="hidden" name="worksiteId" value={worksiteId} />

        <Field label="Faena" htmlFor="physicalWorksiteId" required>
          <Select value={worksiteId} onValueChange={setWorksiteId}>
            <SelectTrigger id="physicalWorksiteId">
              <SelectValue placeholder="Selecciona faena" />
            </SelectTrigger>
            <SelectContent>
              {worksites.map((worksite) => (
                <SelectItem key={worksite.id} value={worksite.id}>{worksite.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <div className="max-h-[360px] overflow-y-auto rounded-lg border border-(--color-border)">
          {visibleProducts.length === 0 ? (
            <p className="px-3 py-4 text-sm text-(--color-text-muted)">No hay productos activos disponibles para contar en esta faena.</p>
          ) : (
            <div className="divide-y divide-(--color-border)">
              {visibleProducts.map((product) => (
                <div key={product.productId} className="grid grid-cols-[minmax(0,1fr)_92px] gap-3 px-3 py-3">
                  <input type="hidden" name="countProductId" value={product.productId} />
                  <input type="hidden" name="itemNotes" value="" />
                  <div className="min-w-0">
                    <p title={product.productName} className="truncate text-sm font-medium text-(--color-text)">{product.productName}</p>
                    <p className="text-xs text-(--color-text-muted)">
                      {product.productSku ? `${product.productSku} · ` : ""}Sistema: {product.quantity} {product.unitOfMeasure}
                    </p>
                  </div>
                  <Input
                    aria-label={`Cantidad contada ${product.productName}`}
                    name="countedQuantity"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="—"
                    className="h-8 text-right tabular-nums"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <Field label="Notas" htmlFor="physicalNotes">
          <Textarea
            id="physicalNotes"
            name="notes"
            rows={2}
            placeholder="Ej: cierre mensual, conteo por cambio de turno..."
          />
        </Field>

        {state.ok === false && state.message && state !== INITIAL_STATE && (
          <p className="text-sm text-[var(--color-danger)] flex items-center gap-1.5">
            <Warning size={14} /> {state.message}
          </p>
        )}

        <div className="flex justify-end pt-2">
          <SubmitButton
            label="Cerrar conteo"
            loadingLabel="Cerrando..."
            variant="primary"
            disabled={!worksiteId || visibleProducts.length === 0 || pending}
          />
        </div>
      </form>
    </section>
  )
}
