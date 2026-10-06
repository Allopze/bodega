"use client"

import * as React from "react"
import { useActionState } from "react"
import { ClipboardText, Warning, MagnifyingGlass } from "@phosphor-icons/react"
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { INITIAL_STATE } from "@/lib/form-state"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/lib/toast"
import { formatQty, matchesQuery, quantityStep } from "@/lib/utils"
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
  onDone,
}: {
  worksiteId: string
  products: WorksiteProductOption[]
  /** Borrador abierto de esta faena, si lo hay: el conteo se retoma donde quedó. */
  draft?: OpenCountDraft | null
  /** Se llama al cerrar el conteo (no al guardar el borrador), para cerrar la hoja. */
  onDone?: () => void
}) {
  const formRef = React.useRef<HTMLFormElement>(null)
  const [query, setQuery] = React.useState("")
  const [showAll, setShowAll] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  // TRV-02 (auditoría 2026-10-05): las cantidades pasan a estado controlado
  // porque la diferencia por fila y el resumen de cierre las necesitan. Sigue
  // siendo un `<input name="countedQuantity">` por producto, así que el envío
  // no cambia: en blanco = no contado (la acción lo salta), 0 = no queda nada.
  const [counts, setCounts] = React.useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const item of draft?.items ?? []) initial[item.productId] = String(item.countedQuantity)
    return initial
  })

  // El aviso y el cierre salen dentro de la acción: la hoja queda montada
  // después de revalidar, así que sin cerrarla seguiría abierta sobre datos
  // viejos (antes la cerraba el remontaje de toda la plataforma).
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await closePhysicalInventoryCountAction(prev, formData)
    setConfirmOpen(false)
    if (result.ok) {
      if (result.message) toast.success(result.message)
      formRef.current?.reset()
      setCounts({})
      onDone?.()
    } else if (result.message) {
      toast.error(result.message)
    }
    return result
  }, INITIAL_STATE)
  // El borrador no cierra la hoja: se guarda para retomar el conteo.
  const [draftState, draftAction, draftPending] = useActionState<ActionState, FormData>(savePhysicalInventoryDraftAction, INITIAL_STATE)

  React.useEffect(() => {
    if (draftState.ok && draftState.message) toast.success(draftState.message)
    else if (draftState.ok === false && draftState.message && draftState !== INITIAL_STATE) toast.error(draftState.message)
  }, [draftState])

  const rawOf = (productId: string) => counts[productId] ?? ""
  const isCounted = (productId: string) => rawOf(productId).trim() !== ""
  const countedOf = (productId: string) => {
    const raw = rawOf(productId).trim()
    return raw === "" ? null : Number(raw)
  }
  const diffOf = (product: WorksiteProductOption) => {
    const counted = countedOf(product.productId)
    if (counted === null || !Number.isFinite(counted) || counted < 0) return null
    return Math.round((counted - product.quantity) * 1000) / 1000
  }

  // Por defecto sólo lo que la faena tiene o ha movido (o ya fue contado):
  // contar 266 filas cuando 8 tienen existencias esconde lo que importa. Un
  // producto en 0 que sí tuvo movimientos entra: es justo el que conviene
  // recontar. Buscar o pedir el catálogo completo trae todas. El filtro sólo
  // esconde filas; los inputs siguen montados para que lo ya tecleado viaje.
  const isRelevant = (product: WorksiteProductOption) =>
    product.quantity !== 0 || product.hasMovements || isCounted(product.productId)
  const isVisible = (product: WorksiteProductOption) => {
    if (!matchesQuery(query, [product.productName, product.productSku])) return false
    if (showAll || query.trim() !== "") return true
    return isRelevant(product)
  }

  const visibleCount = products.filter(isVisible).length
  const withStockCount = products.filter(isRelevant).length
  const hiddenByDefault = products.length - withStockCount

  const countedRows = products.filter((product) => isCounted(product.productId))
  const invalidRows = countedRows.filter((product) => diffOf(product) === null)
  const adjustments = countedRows
    .map((product) => ({ product, diff: diffOf(product) }))
    .filter((row): row is { product: WorksiteProductOption; diff: number } => row.diff !== null && row.diff !== 0)
  const uncountedCount = products.length - countedRows.length

  return (
    <section className="rounded-[var(--radius-xl)] border border-(--color-border) bg-(--color-surface)">
      <div className="border-b border-(--color-border) px-5 py-4">
        <h2 className="text-h2 flex items-center gap-2 text-(--color-text)">
          <ClipboardText size={16} className="text-(--color-text-muted)" />
          Conteo físico
        </h2>
        <p className="mt-0.5 text-xs text-(--color-text-muted)">
          {draft
            ? `Retomando el borrador ${draft.code}. Antes de cerrar verás un resumen de los ajustes.`
            : "Cuenta lo que hay en la estantería. Antes de cerrar verás un resumen de los ajustes."}
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

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="text-xs text-(--color-text-muted)">
            Deja <strong className="font-semibold text-(--color-text)">en blanco</strong> lo que no cuentes: no se ajusta.
            Un <strong className="font-semibold text-(--color-text)">0</strong> significa que no queda nada.
          </p>
          {(hiddenByDefault > 0 || showAll) && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowAll((value) => !value)}>
              {showAll ? `Mostrar sólo con stock o movimientos (${withStockCount})` : `Mostrar todo el catálogo (${products.length})`}
            </Button>
          )}
        </div>

        <div className="rounded-lg border border-(--color-border)">
          {products.length === 0 ? (
            <p className="px-3 py-4 text-sm text-(--color-text-muted)">No hay productos activos disponibles para contar en esta faena.</p>
          ) : visibleCount === 0 ? (
            <p className="px-3 py-4 text-sm text-(--color-text-muted)">
              {query.trim() !== "" ? "Ningún producto coincide con la búsqueda." : "Ningún producto tiene stock ni movimientos en esta faena. Muestra el catálogo completo para contar."}
            </p>
          ) : (
            <>
              <div
                aria-hidden
                className="grid grid-cols-[minmax(0,1fr)_92px_72px] gap-3 border-b border-(--color-border) bg-(--color-surface-2) px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)"
              >
                <span>Producto</span>
                <span className="text-right" title="Cantidad contada. En blanco = no contado">Contado</span>
                <span className="text-right" title="Contado menos lo que dice el sistema">Dif.</span>
              </div>
              <div className="divide-y divide-(--color-border)">
                {products.map((product) => {
                  const diff = diffOf(product)
                  return (
                    <div
                      key={product.productId}
                      hidden={!isVisible(product)}
                      className={`grid grid-cols-[minmax(0,1fr)_92px_72px] items-center gap-3 px-3 py-3 ${diff ? "bg-(--color-warning-tint)" : ""}`}
                    >
                      <input type="hidden" name="countProductId" value={product.productId} />
                      <input type="hidden" name="itemNotes" value="" />
                      <div className="min-w-0">
                        {/* Sin `truncate`: la talla/variante vive en el nombre y se
                            perdía en móvil justo mientras se contaba. */}
                        <p className="break-words text-sm font-medium text-(--color-text)">{product.productName}</p>
                        <p className="text-xs text-(--color-text-muted)">
                          {product.productSku ? `${product.productSku} · ` : ""}Sistema: {formatQty(product.quantity, product.unitOfMeasure)}
                        </p>
                      </div>
                      <Input
                        aria-label={`Cantidad contada ${product.productName}`}
                        name="countedQuantity"
                        type="number"
                        min="0"
                        step={quantityStep(product.unitOfMeasure)}
                        placeholder="—"
                        value={rawOf(product.productId)}
                        onChange={(e) => setCounts((prev) => ({ ...prev, [product.productId]: e.target.value }))}
                        className="h-8 text-right tabular-nums"
                      />
                      <span
                        aria-label={diff === null ? "Sin contar" : diff === 0 ? "Sin diferencia" : `Diferencia ${diff > 0 ? "+" : "-"}${Math.abs(diff)}`}
                        className={`text-right text-sm tabular-nums ${
                          diff === null || diff === 0
                            ? "text-(--color-text-subtle)"
                            : diff > 0 ? "font-semibold text-(--color-success-ink)" : "font-semibold text-(--color-danger-ink)"
                        }`}
                      >
                        {diff === null ? "" : diff === 0 ? "0" : `${diff > 0 ? "+" : "−"}${formatQty(Math.abs(diff))}`}
                      </span>
                    </div>
                  )
                })}
              </div>
            </>
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

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          <p className="mr-auto text-xs text-(--color-text-muted)" aria-live="polite">
            {countedRows.length} contado{countedRows.length === 1 ? "" : "s"} · {adjustments.length} con diferencia
          </p>
          {/* Guardar sin cerrar: un conteo de faena grande no se termina de una
              sentada, y hasta ahora la única salida era cerrarlo o perderlo. Es
              el primer botón de envío: Enter dentro de una cantidad guarda el
              borrador y nunca cierra el conteo sin pasar por la confirmación. */}
          <Button
            type="submit"
            formAction={draftAction}
            variant="secondary"
            disabled={!worksiteId || products.length === 0 || draftPending || pending}
          >
            {draftPending ? "Guardando..." : "Guardar borrador"}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => setConfirmOpen(true)}
            disabled={!worksiteId || products.length === 0 || countedRows.length === 0 || pending || draftPending}
          >
            Cerrar conteo
          </Button>
        </div>
      </form>

      {/* TRV-02: el cierre aplica ajustes de inventario sin vuelta atrás; antes
          cerraba de inmediato y sin decir cuáles. */}
      <Dialog open={confirmOpen} onOpenChange={(open) => { if (!pending) setConfirmOpen(open) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cerrar conteo</DialogTitle>
            <DialogDescription>
              {adjustments.length === 0
                ? "Ningún producto contado difiere del sistema: el conteo se cierra sin ajustes."
                : `Se crearán ${adjustments.length} ajuste${adjustments.length === 1 ? "" : "s"} de inventario. Esta acción no se puede deshacer.`}
            </DialogDescription>
          </DialogHeader>
          {adjustments.length > 0 && (
            <ul className="max-h-[40vh] divide-y divide-(--color-border) overflow-y-auto rounded-lg border border-(--color-border) text-sm">
              {adjustments.map(({ product, diff }) => (
                <li key={product.productId} className="flex items-start justify-between gap-3 px-3 py-2">
                  <span className="min-w-0 break-words text-(--color-text)">{product.productName}</span>
                  <span className="shrink-0 text-right tabular-nums text-(--color-text-muted)">
                    {formatQty(product.quantity)} → {formatQty(countedOf(product.productId) ?? 0)}{" "}
                    <strong className={diff > 0 ? "text-(--color-success-ink)" : "text-(--color-danger-ink)"}>
                      ({diff > 0 ? "+" : "−"}{formatQty(Math.abs(diff))})
                    </strong>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {uncountedCount > 0 && (
            <p className="text-xs text-(--color-text-muted)">
              {uncountedCount} producto{uncountedCount === 1 ? "" : "s"} sin contar: no se modifican.
            </p>
          )}
          {invalidRows.length > 0 && (
            <p role="alert" className="text-sm text-(--color-danger-ink)">
              {invalidRows.length} cantidad{invalidRows.length === 1 ? "" : "es"} inválida{invalidRows.length === 1 ? "" : "s"} (negativa o no numérica). Corrígela{invalidRows.length === 1 ? "" : "s"} antes de cerrar.
            </p>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={pending}>Volver al conteo</Button>
            <Button
              variant="primary"
              loading={pending}
              disabled={invalidRows.length > 0}
              onClick={() => formRef.current?.requestSubmit()}
            >
              Cerrar conteo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
