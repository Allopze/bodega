"use client"

import * as React from "react"
import { useActionState } from "react"
import { ClipboardText, Warning, MagnifyingGlass } from "@phosphor-icons/react"
import { SubmitButton } from "@/components/ui/submit-button"
import { Button } from "@/components/ui/button"
import { INITIAL_STATE } from "@/lib/form-state"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/lib/toast"
import { matchesQuery, quantityStep } from "@/lib/utils"
import type { ActionState } from "@/lib/validation/operations"
import { closePhysicalInventoryCountAction, savePhysicalInventoryDraftAction } from "./actions"
import type { WorksiteProductOption } from "./movement-options"

export interface OpenCountDraft {
  id: string
  code: string
  items: Array<{ productId: string; countedQuantity: number }>
}

export function PhysicalInventoryPanel({
  worksiteId,
  products,
  draft = null,
}: {
  worksiteId: string
  products: WorksiteProductOption[]
  /** Borrador abierto de esta faena, si lo hay: el conteo se retoma donde quedó. */
  draft?: OpenCountDraft | null
}) {
  const formRef = React.useRef<HTMLFormElement>(null)
  const [query, setQuery] = React.useState("")
  const [state, action, pending] = useActionState<ActionState, FormData>(closePhysicalInventoryCountAction, INITIAL_STATE)
  const [draftState, draftAction, draftPending] = useActionState<ActionState, FormData>(savePhysicalInventoryDraftAction, INITIAL_STATE)

  React.useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
      formRef.current?.reset()
    } else if (state.ok === false && state.message && state !== INITIAL_STATE) {
      toast.error(state.message)
    }
  }, [state])

  React.useEffect(() => {
    if (draftState.ok && draftState.message) toast.success(draftState.message)
    else if (draftState.ok === false && draftState.message && draftState !== INITIAL_STATE) toast.error(draftState.message)
  }, [draftState])

  const draftByProduct = React.useMemo(() => {
    const map = new Map<string, number>()
    for (const item of draft?.items ?? []) map.set(item.productId, item.countedQuantity)
    return map
  }, [draft])

  // El filtro sólo esconde filas; los inputs siguen montados para que lo ya
  // tecleado viaje en el envío aunque el producto no esté visible al enviar.
  const isVisible = (product: WorksiteProductOption) =>
    matchesQuery(query, [product.productName, product.productSku])

  const visibleCount = products.filter(isVisible).length

  return (
    <section className="rounded-[var(--radius-xl)] border border-(--color-border) bg-(--color-surface)">
      <div className="border-b border-(--color-border) px-5 py-4">
        <h2 className="text-h2 flex items-center gap-2 text-(--color-text)">
          <ClipboardText size={16} className="text-(--color-text-muted)" />
          Conteo físico
        </h2>
        <p className="mt-0.5 text-xs text-(--color-text-muted)">
          {draft
            ? `Retomando el borrador ${draft.code}. Cierre con ajustes automáticos por diferencia.`
            : "Cierre formal con ajustes automáticos por diferencia"}
        </p>
      </div>

      <form ref={formRef} action={action} className="flex flex-col gap-4 p-5">
        <input type="hidden" name="worksiteId" value={worksiteId} />
        {draft && <input type="hidden" name="countId" value={draft.id} />}

        <div className="relative flex items-center">
          <MagnifyingGlass size={14} aria-hidden className="pointer-events-none absolute left-2.5 text-(--color-text-subtle)" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar producto o SKU..."
            aria-label="Buscar producto en el conteo"
            className="h-8 pl-8 text-xs"
          />
        </div>

        <div className="max-h-[360px] overflow-y-auto rounded-lg border border-(--color-border)">
          {products.length === 0 ? (
            <p className="px-3 py-4 text-sm text-(--color-text-muted)">No hay productos activos disponibles para contar en esta faena.</p>
          ) : visibleCount === 0 ? (
            <p className="px-3 py-4 text-sm text-(--color-text-muted)">Ningún producto coincide con la búsqueda.</p>
          ) : (
            <div className="divide-y divide-(--color-border)">
              {products.map((product) => (
                <div
                  key={product.productId}
                  hidden={!isVisible(product)}
                  className="grid grid-cols-[minmax(0,1fr)_92px] gap-3 px-3 py-3"
                >
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
                    step={quantityStep(product.unitOfMeasure)}
                    placeholder="—"
                    defaultValue={draftByProduct.has(product.productId) ? String(draftByProduct.get(product.productId)) : ""}
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

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          {/* Guardar sin cerrar: un conteo de faena grande no se termina de una
              sentada, y hasta ahora la única salida era cerrarlo o perderlo. */}
          <Button
            type="submit"
            formAction={draftAction}
            variant="secondary"
            disabled={!worksiteId || products.length === 0 || draftPending || pending}
          >
            {draftPending ? "Guardando..." : "Guardar borrador"}
          </Button>
          <SubmitButton
            label="Cerrar conteo"
            loadingLabel="Cerrando..."
            variant="primary"
            disabled={!worksiteId || products.length === 0 || pending || draftPending}
          />
        </div>
      </form>
    </section>
  )
}
