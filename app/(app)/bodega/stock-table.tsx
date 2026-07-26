"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { Check, PencilSimple } from "@phosphor-icons/react"
import type { WorksiteStockWithProduct } from "./types"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { formatQty, formatDate } from "@/lib/utils"
import { setMinStockAction } from "./actions"
import { INITIAL_STATE } from "@/components/admin/form-state"
import type { ActionState } from "@/lib/validation/operations"
import { StockExportButton } from "./stock-export-button"

export interface StockTableProps {
  worksites: Array<{
    id: string
    name: string
    items: WorksiteStockWithProduct[]
  }>
  canExport?: boolean
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
        className="flex min-h-11 min-w-11 items-center gap-1 text-xs text-[var(--color-text-subtle)] transition-colors hover:text-[var(--color-text)] sm:min-h-6 sm:min-w-6"
        title="Configurar stock mínimo"
        aria-label="Configurar stock mínimo"
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
        aria-label="Stock mínimo"
      />
      <Button
        type="submit"
        variant="ghost"
        size="icon-mobile-sm"
        aria-label="Guardar stock mínimo"
        className="text-[var(--color-success)]"
      >
        <Check size={14} />
      </Button>
    </form>
  )
}

export function StockTable({ worksites, canExport }: StockTableProps) {
  const allItems = worksites.flatMap((ws) => ws.items)
  const lowStockCount = allItems.filter((item) => item.minStock > 0 && item.quantity <= item.minStock).length

  return (
    <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
        <div>
          <h2 className="text-h2 text-[var(--color-text)]">Stock por faena</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {allItems.length} {allItems.length === 1 ? "producto" : "productos"} en {worksites.length} {worksites.length === 1 ? "faena" : "faenas"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lowStockCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-full)] border border-[var(--color-signal-line)] bg-[var(--color-signal-tint)] px-2.5 py-1 text-xs font-semibold text-[var(--color-signal-ink)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-signal)]" />
              {lowStockCount} bajo mínimo
            </span>
          )}
          <StockExportButton
            worksites={worksites.map((ws) => ({ id: ws.id, name: ws.name }))}
            canExport={canExport ?? false}
          />
        </div>
      </div>

      {allItems.length === 0 ? (
        <EmptyState
          title="Sin stock registrado"
          description="Los ingresos de OC aparecerán aquí."
          compact
        />
      ) : (
        <>
          <div className="grid gap-3 p-5 md:hidden">
            {worksites.map((ws) => (
              <div key={ws.id} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">
                  {ws.name}
                </h3>
                {ws.items.map((s) => {
                  const unit = s.product?.unitOfMeasure ?? "u"
                  const lowStock = s.minStock > 0 && s.quantity <= s.minStock

                  return (
                    <article
                      key={s.id}
                      className={[
                        "rounded-[var(--radius-lg)] border bg-[var(--color-surface)] p-4",
                        lowStock ? "border-[var(--color-signal-line)]" : "border-[var(--color-border)]",
                      ].join(" ")}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[var(--color-text)]">{s.product?.name ?? s.productId}</p>
                          {s.product?.sku && (
                            <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">{s.product.sku}</p>
                          )}
                        </div>
                        {lowStock && (
                          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-signal-ink)]">
                            Bajo mínimo
                          </span>
                        )}
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                        <div>
                          <dt className="text-[var(--color-text-subtle)]">Stock actual</dt>
                          <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-[var(--color-text)]">
                            {formatQty(s.quantity, unit)}
                          </dd>
                        </div>
                        <div className="text-right">
                          <dt className="text-[var(--color-text-subtle)]">Mínimo</dt>
                          <dd className="mt-0.5 flex justify-end"><MinStockCell stockId={s.id} currentMin={s.minStock} /></dd>
                        </div>
                      </dl>
                    </article>
                  )
                })}
              </div>
            ))}
          </div>

          <div className="hidden md:block">
            {worksites.map((ws, wsIndex) => (
              <div key={ws.id}>
                <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-5 py-2.5">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">
                    {ws.name}
                    <span className="ml-2 font-normal normal-case tracking-normal">
                      {ws.items.length} {ws.items.length === 1 ? "producto" : "productos"}
                    </span>
                  </h3>
                </div>
                <table className="w-full text-sm" aria-label={`Stock en ${ws.name}`}>
                  <caption className="sr-only">Productos y cantidades en faena {ws.name}</caption>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {ws.items.map((s) => {
                      const unit = s.product?.unitOfMeasure ?? "u"
                      const lowStock = s.minStock > 0 && s.quantity <= s.minStock

                      return (
                        <tr key={s.id} className="hover:bg-[var(--color-surface-2)] transition-colors">
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2.5">
                              {lowStock && (
                                <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-signal)]" role="img" aria-label="Stock bajo" />
                              )}
                              <div className="min-w-0">
                                <p className="font-medium text-[var(--color-text)]">{s.product?.name ?? s.productId}</p>
                                {s.product?.sku && (
                                  <p className="mt-0.5 font-mono text-[11px] text-[var(--color-text-subtle)]">{s.product.sku}</p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3 text-right">
                            <span className="font-mono text-sm font-semibold tabular-nums text-[var(--color-text)]">
                              {formatQty(s.quantity, unit)}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-right">
                            <MinStockCell stockId={s.id} currentMin={s.minStock} />
                          </td>
                          <td className="px-5 py-3 text-right text-xs text-[var(--color-text-subtle)]">
                            {s.lastMovementAt ? formatDate(s.lastMovementAt) : "—"}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {wsIndex < worksites.length - 1 && (
                  <div className="border-b-2 border-[var(--color-border-strong)]" />
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
