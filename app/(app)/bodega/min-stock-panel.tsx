"use client"

import * as React from "react"
import { useActionState } from "react"
import { Gauge, Warning, MagnifyingGlass } from "@phosphor-icons/react"
import { SubmitButton } from "@/components/ui/submit-button"
import { INITIAL_STATE } from "@/lib/form-state"
import { Input } from "@/components/ui/input"
import { toast } from "@/lib/toast"
import { matchesQuery, quantityStep } from "@/lib/utils"
import type { ActionState } from "@/lib/validation/operations"
import { setMinStockBulkAction } from "./actions"
import type { WorksiteProductOption } from "./movement-options"

/**
 * Definición masiva de stock mínimo por faena.
 *
 * Toda la maquinaria de alertas (el KPI del encabezado, el badge del sidebar,
 * los avisos del dashboard y el filtro `?stock=low`) depende de `minStock`, y
 * seguía apagada porque la única forma de fijarlo era un lápiz por fila. Este
 * formulario es el mismo molde del conteo físico: N filas por faena y
 * `formData.getAll()` en el servidor.
 */
export function MinStockPanel({
  worksiteId,
  worksiteName,
  products,
  onDone,
}: {
  worksiteId: string
  worksiteName: string
  products: WorksiteProductOption[]
  /** Se llama cuando el movimiento queda registrado, para cerrar la hoja. */
  onDone?: () => void
}) {
  const formRef = React.useRef<HTMLFormElement>(null)
  const [query, setQuery] = React.useState("")
  // El aviso y el cierre salen dentro de la acción: la hoja queda montada
  // después de revalidar, así que sin cerrarla seguiría abierta sobre datos
  // viejos (antes la cerraba el remontaje de toda la plataforma).
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await setMinStockBulkAction(prev, formData)
    if (result.ok) {
      if (result.message) toast.success(result.message)
      onDone?.()
    } else if (result.message) {
      toast.error(result.message)
    }
    return result
  }, INITIAL_STATE)

  // Sólo los productos con fila en `worksite_stock`: el mínimo se guarda contra
  // esa fila, y un producto que nunca tuvo movimiento en la faena no la tiene.
  const editable = products.filter((product) => product.stockId !== null)
  const isVisible = (product: WorksiteProductOption) =>
    matchesQuery(query, [product.productName, product.productSku])
  const visibleCount = editable.filter(isVisible).length

  return (
    <section className="rounded-[var(--radius-xl)] border border-(--color-border) bg-(--color-surface)">
      <div className="border-b border-(--color-border) px-5 py-4">
        <h2 className="text-h2 flex items-center gap-2 text-(--color-text)">
          <Gauge size={16} className="text-(--color-text-muted)" />
          Stock mínimo · {worksiteName}
        </h2>
        <p className="mt-0.5 text-xs text-(--color-text-muted)">
          Deja en blanco para no tocar un producto. Un 0 explícito borra el umbral.
        </p>
      </div>

      <form ref={formRef} action={action} className="flex flex-col gap-4 p-5">
        <input type="hidden" name="worksiteId" value={worksiteId} />

        <div className="relative flex items-center">
          <MagnifyingGlass size={14} aria-hidden className="pointer-events-none absolute left-2.5 text-(--color-text-subtle)" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar producto o SKU..."
            aria-label="Buscar producto"
            className="h-8 pl-8 text-xs"
          />
        </div>

        <div className="max-h-[360px] overflow-y-auto rounded-lg border border-(--color-border)">
          {editable.length === 0 ? (
            <p className="px-3 py-4 text-sm text-(--color-text-muted)">
              Esta faena todavía no tiene existencias registradas: el mínimo se puede fijar una vez que el producto tenga su primer movimiento.
            </p>
          ) : visibleCount === 0 ? (
            <p className="px-3 py-4 text-sm text-(--color-text-muted)">Ningún producto coincide con la búsqueda.</p>
          ) : (
            <div className="divide-y divide-(--color-border)">
              {editable.map((product) => (
                <div
                  key={product.productId}
                  hidden={!isVisible(product)}
                  className="grid grid-cols-[minmax(0,1fr)_92px] gap-3 px-3 py-3"
                >
                  {/* `readOnly` y no `disabled` en los inputs: un campo
                      deshabilitado no se envía y desalinearía los arreglos
                      paralelos que `getAll()` reconstruye en el servidor. */}
                  <input type="hidden" name="minStockId" value={product.stockId ?? ""} />
                  <div className="min-w-0">
                    <p title={product.productName} className="truncate text-sm font-medium text-(--color-text)">{product.productName}</p>
                    <p className="text-xs text-(--color-text-muted)">
                      {product.productSku ? `${product.productSku} · ` : ""}
                      Stock: {product.quantity} {product.unitOfMeasure}
                      {product.minStock > 0 ? ` · mín. actual ${product.minStock}` : " · sin mínimo"}
                    </p>
                  </div>
                  <Input
                    aria-label={`Stock mínimo de ${product.productName}`}
                    name="minStockValue"
                    type="number"
                    min="0"
                    step={quantityStep(product.unitOfMeasure)}
                    placeholder={product.minStock > 0 ? String(product.minStock) : "—"}
                    className="h-8 text-right tabular-nums"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {state.ok === false && state.message && state !== INITIAL_STATE && (
          <p className="text-sm text-[var(--color-danger)] flex items-center gap-1.5">
            <Warning size={14} /> {state.message}
          </p>
        )}

        <div className="flex justify-end pt-2">
          <SubmitButton
            label="Guardar mínimos"
            loadingLabel="Guardando..."
            variant="primary"
            disabled={!worksiteId || editable.length === 0 || pending}
          />
        </div>
      </form>
    </section>
  )
}
