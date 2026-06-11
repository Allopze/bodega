"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "sonner"
import { Check, PencilSimple } from "@phosphor-icons/react"
import type { WorksiteStockWithProduct } from "./types"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { formatQty, formatDate } from "@/lib/utils"
import { setMinStockAction } from "./actions"
import { INITIAL_STATE } from "@/components/admin/form-state"
import type { ActionState } from "@/lib/validation/operations"

export interface StockTableProps {
  worksiteName: string
  items: WorksiteStockWithProduct[]
}

function MinStockCell({ stockId, currentMin }: { stockId: string; currentMin: number }) {
  const [editing, setEditing] = React.useState(false)
  const [value, setValue] = React.useState(String(currentMin))
  const formRef = React.useRef<HTMLFormElement>(null)

  const [state, action] = useActionState<ActionState, FormData>(setMinStockAction, INITIAL_STATE)

  React.useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
      setEditing(false)
    }
  }, [state])

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="flex items-center gap-1 text-xs text-[var(--color-text-subtle)] hover:text-[var(--color-text)] transition-colors"
        title="Configurar stock mínimo"
      >
        <span className="font-mono tabular-nums">{currentMin > 0 ? formatQty(currentMin, "") : "—"}</span>
        <PencilSimple size={11} />
      </button>
    )
  }

  return (
    <form ref={formRef} action={action} className="flex items-center gap-1">
      <input type="hidden" name="stockId" value={stockId} />
      <Input
        name="minStock"
        type="number"
        min="0"
        step="1"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-20 h-7 text-xs tabular-nums"
        autoFocus
      />
      <button type="submit" className="h-7 w-7 flex items-center justify-center rounded-sm text-[var(--color-success)] hover:bg-[var(--color-surface-2)] transition-colors">
        <Check size={14} />
      </button>
    </form>
  )
}

export function StockTable({ worksiteName, items }: StockTableProps) {
  return (
    <div>
      <h2 className="text-h2 mb-3">{worksiteName}</h2>

      {items.length === 0 ? (
        <EmptyState
          title="Sin stock en esta faena"
          description="Los ingresos de OC aparecerán aquí."
          compact
        />
      ) : (
        <>
          <div className="grid gap-2 md:hidden">
            {items.map((s) => {
              const unit = s.product?.unitOfMeasure ?? "u"
              const lowStock = s.minStock > 0 && s.quantity <= s.minStock

              return (
                <article
                  key={s.id}
                  className={[
                    "rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4",
                    lowStock ? "ring-1 ring-inset ring-[var(--color-signal-line)]" : "",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--color-text)]">{s.product?.name ?? s.productId}</p>
                      <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
                        {s.product?.sku ? <span className="font-mono">{s.product.sku}</span> : "Sin SKU"}
                      </p>
                    </div>
                    {lowStock && (
                      <span className="shrink-0 rounded border border-[var(--color-signal-line)] bg-[var(--color-signal-tint)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-signal-ink)]">
                        Stock bajo
                      </span>
                    )}
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <div>
                      <dt className="text-[var(--color-text-subtle)]">Stock</dt>
                      <dd className="font-mono tabular-nums text-[var(--color-text)]">{formatQty(s.quantity, unit)}</dd>
                    </div>
                    <div className="text-right">
                      <dt className="text-[var(--color-text-subtle)]">Mínimo</dt>
                      <dd className="flex justify-end"><MinStockCell stockId={s.id} currentMin={s.minStock} /></dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-[var(--color-text-subtle)]">Último movimiento</dt>
                      <dd className="text-[var(--color-text-muted)]">{s.lastMovementAt ? formatDate(s.lastMovementAt) : "—"}</dd>
                    </div>
                  </dl>
                </article>
              )
            })}
          </div>

          <div className="hidden overflow-hidden rounded-[var(--radius-2xl)] shadow-[var(--shadow-card)] bg-[var(--color-surface)] md:block">
            <table className="w-full text-sm" aria-label={`Stock en ${worksiteName}`}>
              <caption className="sr-only">Productos y cantidades en faena {worksiteName}</caption>
              <thead className="bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-muted)]">Producto</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-muted)] w-28">Stock</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-muted)] w-20">Mínimo</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-muted)] w-40">Último mov.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {items.map((s) => {
                  const unit = s.product?.unitOfMeasure ?? "u"
                  const lowStock = s.minStock > 0 && s.quantity <= s.minStock

                  return (
                    <tr key={s.id} className={`hover:bg-[var(--color-surface-2)] transition-colors ${lowStock ? "bg-[var(--color-signal-tint)]" : ""}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {s.product?.sku && (
                            <span className="font-mono text-[11px] text-[var(--color-text-subtle)] bg-[var(--color-surface-2)] px-1.5 py-0.5 rounded">
                              {s.product.sku}
                            </span>
                          )}
                          <span className="font-medium text-[var(--color-text)]">
                            {s.product?.name ?? s.productId}
                          </span>
                          {lowStock && (
                            <span className="text-[10px] font-medium text-[var(--color-signal-ink)] bg-[var(--color-signal-tint)] border border-[var(--color-signal-line)] px-1.5 py-0.5 rounded">
                              Stock bajo
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-muted)]">
                        {formatQty(s.quantity, unit)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <MinStockCell stockId={s.id} currentMin={s.minStock} />
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-[var(--color-text-subtle)]">
                        {s.lastMovementAt ? formatDate(s.lastMovementAt) : "—"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
