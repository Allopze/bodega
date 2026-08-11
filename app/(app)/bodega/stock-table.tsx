"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { Check, PencilSimple } from "@phosphor-icons/react"
import type { WorksiteStockWithProduct } from "./types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { formatQty, formatDate, formatDateRelative } from "@/lib/utils"
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

type GroupBy = "faena" | "producto"

/** Una banda de la tabla: el encabezado del grupo y sus filas ya rotuladas. */
interface StockGroup {
  id: string
  heading: string
  meta: string
  rows: Array<{ item: WorksiteStockWithProduct; title: string; subtitle: string }>
}

/**
 * Agrupar por producto es la única forma de responder "¿cuánto guante tenemos?":
 * por faena, un producto repartido en tres faenas son tres números sueltos que
 * hay que sumar de cabeza. El total va en el encabezado del grupo.
 */
function buildGroups(worksites: StockTableProps["worksites"], groupBy: GroupBy): StockGroup[] {
  if (groupBy === "faena") {
    return worksites.map((ws) => ({
      id: ws.id,
      heading: ws.name,
      meta: `${ws.items.length} ${ws.items.length === 1 ? "producto" : "productos"}`,
      rows: ws.items.map((item) => ({
        item,
        title: item.product?.name ?? item.productId,
        // La unidad viaja con el SKU y no con la cantidad: en la columna numérica
        // el sufijo empujaba los dígitos y "200" no alineaba con "2".
        subtitle: item.product?.sku
          ? `${item.product.sku} · ${item.product.unitOfMeasure}`
          : (item.product?.unitOfMeasure ?? "u"),
      })),
    }))
  }

  const byProduct = new Map<string, { heading: string; sku: string | null; unit: string; total: number; rows: StockGroup["rows"] }>()
  for (const ws of worksites) {
    for (const item of ws.items) {
      const group = byProduct.get(item.productId) ?? {
        heading: item.product?.name ?? item.productId,
        sku: item.product?.sku ?? null,
        unit: item.product?.unitOfMeasure ?? "u",
        total: 0,
        rows: [],
      }
      group.total += item.quantity
      // El nombre de la faena viene del grupo que la contiene, no de la relación
      // del ítem: es el mismo que rotula el modo "por faena".
      group.rows.push({ item, title: ws.name, subtitle: "" })
      byProduct.set(item.productId, group)
    }
  }

  return [...byProduct.entries()]
    .sort(([, a], [, b]) => a.heading.localeCompare(b.heading, "es"))
    .map(([productId, group]) => ({
      id: productId,
      heading: group.heading,
      meta: [
        group.sku,
        `${formatQty(group.total, group.unit)} en ${group.rows.length} ${group.rows.length === 1 ? "faena" : "faenas"}`,
      ].filter(Boolean).join(" · "),
      rows: group.rows,
    }))
}

const GROUP_BY_STORAGE_KEY = "bodega:stock-group-by"
const GROUP_BY_LABEL: Record<GroupBy, string> = { faena: "Por faena", producto: "Por producto" }

/**
 * `sessionStorage` y no la URL: agrupar es preferencia de vista y se aplica en
 * cliente sobre filas ya cargadas. En la URL obligaría a un viaje al servidor, y
 * en estado de React sola la borraría cualquier `router.refresh()` — hay
 * `loading.tsx`, así que el refresco desmonta el árbol (guardar un mínimo lo
 * dispara).
 */
function useGroupBy(): [GroupBy, (value: GroupBy) => void] {
  const [groupBy, setGroupBy] = React.useState<GroupBy>("faena")
  const [restored, setRestored] = React.useState(false)

  React.useEffect(() => {
    try {
      const saved = sessionStorage.getItem(GROUP_BY_STORAGE_KEY)
      if (saved === "faena" || saved === "producto") setGroupBy(saved)
    } catch { /* modo privado o valor corrupto: queda el default */ }
    setRestored(true)
  }, [])

  React.useEffect(() => {
    // Sin el guard, el primer commit escribiría el default encima de lo leído.
    if (!restored) return
    try { sessionStorage.setItem(GROUP_BY_STORAGE_KEY, groupBy) } catch { /* modo privado */ }
  }, [restored, groupBy])

  return [groupBy, setGroupBy]
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
        className="inline-flex min-h-11 min-w-11 items-center justify-end gap-1 text-xs text-[var(--color-text-subtle)] transition-colors hover:text-[var(--color-text)] sm:min-h-6 sm:min-w-6"
        title={currentMin > 0 ? "Editar stock mínimo" : "Definir stock mínimo"}
        aria-label={currentMin > 0 ? "Editar stock mínimo" : "Definir stock mínimo"}
      >
        {currentMin > 0 ? (
          <span className="font-mono tabular-nums">{formatQty(currentMin, "")}</span>
        ) : (
          <span>Definir</span>
        )}
        <PencilSimple size={11} />
      </button>
    )
  }

  return (
    <form ref={formRef} action={action} className="flex items-center justify-end gap-1">
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
  const [groupBy, setGroupBy] = useGroupBy()
  const groups = React.useMemo(() => buildGroups(worksites, groupBy), [worksites, groupBy])

  return (
    <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
        <div>
          <h2 className="text-h2 text-[var(--color-text)]">Stock {groupBy === "faena" ? "por faena" : "por producto"}</h2>
          {/* "líneas de stock", no "productos": la métrica del encabezado cuenta
              productos distintos y un mismo producto aparece en varias faenas. */}
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {allItems.length} {allItems.length === 1 ? "línea de stock" : "líneas de stock"} en {worksites.length} {worksites.length === 1 ? "faena" : "faenas"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="Agrupar stock" className="inline-flex rounded-[var(--radius)] border border-[var(--color-border)]">
            {(Object.keys(GROUP_BY_LABEL) as GroupBy[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setGroupBy(mode)}
                aria-pressed={groupBy === mode}
                className={[
                  "min-h-11 px-3 text-xs transition-colors first:rounded-l-[var(--radius)] last:rounded-r-[var(--radius)] sm:min-h-7",
                  mode === "producto" && "border-l border-[var(--color-border)]",
                  groupBy === mode
                    ? "bg-[var(--color-primary-tint)] font-semibold text-[var(--color-text)]"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
                ].filter(Boolean).join(" ")}
              >
                {GROUP_BY_LABEL[mode]}
              </button>
            ))}
          </div>
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
            {groups.map((group) => (
              <div key={group.id} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">
                  {group.heading}
                  <span className="ml-2 font-normal normal-case tracking-normal">{group.meta}</span>
                </h3>
                {group.rows.map(({ item: s, title, subtitle }) => {
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
                          <p className="text-sm font-medium text-[var(--color-text)]">{title}</p>
                          {subtitle && (
                            <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">{subtitle}</p>
                          )}
                        </div>
                        {lowStock ? (
                          <Badge variant="signal" dot className="shrink-0">Bajo mínimo</Badge>
                        ) : s.minStock === 0 ? (
                          <span className="shrink-0 text-[11px] text-[var(--color-text-faint)]">Sin mínimo</span>
                        ) : null}
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
                        <div className="col-span-2">
                          <dt className="text-[var(--color-text-subtle)]">Último movimiento</dt>
                          <dd className="mt-0.5 tabular-nums text-[var(--color-text-muted)]">
                            {s.lastMovementAt
                              ? `${formatDate(s.lastMovementAt)} · ${formatDateRelative(s.lastMovementAt)}`
                              : "—"}
                          </dd>
                        </div>
                      </dl>
                    </article>
                  )
                })}
              </div>
            ))}
          </div>

          {/* Una sola <table> para todas las faenas: con una por faena, cada una
              calculaba sus anchos `auto` por separado y las cantidades quedaban
              desalineadas entre grupos. Los anchos viven en el <colgroup>. */}
          <div className="hidden md:block">
            <table className="w-full table-fixed text-sm">
              <caption className="sr-only">
                Stock por producto, agrupado por {groupBy === "faena" ? "faena" : "producto"}
              </caption>
              <colgroup>
                <col />
                <col className="w-36" />
                <col className="w-36" />
                <col className="w-32" />
                <col className="w-44" />
              </colgroup>
              <thead>
                <tr className="border-b border-[var(--color-border)] text-xs uppercase tracking-wide text-[var(--color-text-subtle)]">
                  <th scope="col" className="px-5 py-2.5 text-left font-semibold">
                    {groupBy === "faena" ? "Producto" : "Faena"}
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-left font-semibold">Estado</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-semibold">Stock actual</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-semibold">Mínimo</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-semibold">Último movimiento</th>
                </tr>
              </thead>
              {groups.map((group) => (
                <tbody
                  key={group.id}
                  className="divide-y divide-[var(--color-border)] border-b-2 border-[var(--color-border-strong)] last:border-b-0"
                >
                  <tr>
                    <th
                      scope="rowgroup"
                      colSpan={5}
                      className="bg-[var(--color-surface-2)] px-5 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]"
                    >
                      {group.heading}
                      <span className="ml-2 font-normal normal-case tracking-normal">{group.meta}</span>
                    </th>
                  </tr>
                  {group.rows.map(({ item: s, title, subtitle }) => {
                    const lowStock = s.minStock > 0 && s.quantity <= s.minStock

                    return (
                      <tr key={s.id} className="hover:bg-[var(--color-surface-2)] transition-colors">
                        <td className="px-5 py-3">
                          <p className="font-medium text-[var(--color-text)]">{title}</p>
                          {subtitle && (
                            <p className="mt-0.5 font-mono text-[11px] text-[var(--color-text-subtle)]">{subtitle}</p>
                          )}
                        </td>
                        {/* El punto de color solo decía "bajo mínimo" con color y
                            forma; la etiqueta lo dice con palabras y de paso la
                            columna deja ver qué líneas no tienen umbral. */}
                        <td className="px-5 py-3">
                          {lowStock ? (
                            <Badge variant="signal" dot>Bajo mínimo</Badge>
                          ) : s.minStock === 0 ? (
                            <span className="text-[11px] text-[var(--color-text-faint)]">Sin mínimo</span>
                          ) : null}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span className="font-mono text-sm font-semibold tabular-nums text-[var(--color-text)]">
                            {formatQty(s.quantity)}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <MinStockCell stockId={s.id} currentMin={s.minStock} />
                        </td>
                        <td className="px-5 py-3 text-right text-xs text-[var(--color-text-subtle)]">
                          {s.lastMovementAt ? (
                            <>
                              <span className="tabular-nums">{formatDate(s.lastMovementAt)}</span>
                              <span className="mt-0.5 block text-[11px] text-[var(--color-text-faint)]">
                                {formatDateRelative(s.lastMovementAt)}
                              </span>
                            </>
                          ) : "—"}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              ))}
            </table>
          </div>
        </>
      )}
    </section>
  )
}
