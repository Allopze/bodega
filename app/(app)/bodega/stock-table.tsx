"use client"

import * as React from "react"
import Link from "next/link"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { CaretDown, CaretRight, Check, PencilSimple, X } from "@phosphor-icons/react"
import type { WorksiteStockWithProduct } from "./types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { formatQty, formatDate, formatDateRelative } from "@/lib/utils"
import { setMinStockAction } from "./actions"
import { INITIAL_STATE } from "@/lib/form-state"
import type { ActionState } from "@/lib/validation/operations"
import { StockExportButton } from "./stock-export-button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"

export interface StockTableProps {
  worksites: Array<{
    id: string
    name: string
    items: WorksiteStockWithProduct[]
  }>
  canExport?: boolean
  canSetMinStock?: boolean
}

type GroupBy = "faena" | "producto"
type SortKey = "name" | "quantity" | "minStock" | "lastMovementAt"
type SortDir = "asc" | "desc"

/** Una banda de la tabla: el encabezado del grupo y sus filas ya rotuladas. */
interface StockGroup {
  id: string
  heading: string
  meta: string
  rows: Array<{ item: WorksiteStockWithProduct; title: string; subtitle: string; worksiteId: string }>
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
        worksiteId: ws.id,
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
      group.rows.push({ item, title: ws.name, subtitle: "", worksiteId: ws.id })
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

/** Ordena las filas dentro de cada grupo. El conjunto no está paginado, así que
 *  ordenar en cliente ordena todo lo que hay, no sólo una página. */
function sortRows(rows: StockGroup["rows"], key: SortKey, dir: SortDir): StockGroup["rows"] {
  const factor = dir === "asc" ? 1 : -1
  return [...rows].sort((a, b) => {
    switch (key) {
      case "quantity":
        return (a.item.quantity - b.item.quantity) * factor
      case "minStock":
        return (a.item.minStock - b.item.minStock) * factor
      case "lastMovementAt": {
        // Sin movimiento va siempre al final, mire hacia donde mire el orden:
        // un "—" no es ni el más viejo ni el más nuevo.
        const aAt = a.item.lastMovementAt
        const bAt = b.item.lastMovementAt
        if (!aAt && !bAt) return 0
        if (!aAt) return 1
        if (!bAt) return -1
        return aAt.localeCompare(bAt) * factor
      }
      default:
        return a.title.localeCompare(b.title, "es-CL") * factor
    }
  })
}

const GROUP_BY_STORAGE_KEY = "bodega:stock-group-by"
const COLLAPSED_STORAGE_KEY = "bodega:stock-collapsed"
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

/** Grupos plegados, con la misma persistencia que la agrupación. */
function useCollapsedGroups(): [Set<string>, (id: string) => void] {
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set())
  const [restored, setRestored] = React.useState(false)

  React.useEffect(() => {
    try {
      const saved = sessionStorage.getItem(COLLAPSED_STORAGE_KEY)
      if (saved) setCollapsed(new Set(JSON.parse(saved) as string[]))
    } catch { /* modo privado o valor corrupto */ }
    setRestored(true)
  }, [])

  React.useEffect(() => {
    if (!restored) return
    try { sessionStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...collapsed])) } catch { /* modo privado */ }
  }, [restored, collapsed])

  const toggle = React.useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  return [collapsed, toggle]
}

function MinStockCell({ stockId, currentMin, disabled = false }: { stockId: string; currentMin: number; disabled?: boolean }) {
  const [editing, setEditing] = React.useState(false)
  const [value, setValue] = React.useState(String(currentMin))
  const formRef = React.useRef<HTMLFormElement>(null)

  const [state, action] = useActionState<ActionState, FormData>(setMinStockAction, INITIAL_STATE)

  const cancel = React.useCallback(() => {
    setEditing(false)
    setValue(String(currentMin))
  }, [currentMin])

  React.useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
      setEditing(false)
    } else if (state.ok === false && state.message && state !== INITIAL_STATE) {
      // Sin esta rama, "Sin permisos" / "No tienes acceso a esta faena" /
      // "Error al actualizar" no se veían: la celda se quedaba abierta como si
      // el clic no hubiera ocurrido.
      toast.error(state.message)
    }
  }, [state])

  if (!editing) {
    if (disabled) {
      return currentMin > 0
        ? <span className="font-mono text-xs tabular-nums text-[var(--color-text-subtle)]">{formatQty(currentMin, "")}</span>
        : <span className="text-[11px] text-[var(--color-text-faint)]">—</span>
    }
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
    <form
      ref={formRef}
      action={action}
      className="flex items-center justify-end gap-1"
      // Escape sale sin guardar. Sin esto, un clic accidental en el lápiz dejaba
      // la fila trabada en modo edición: la única salida era enviar o recargar.
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); cancel() } }}
    >
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
      <Button
        type="button"
        variant="ghost"
        size="icon-mobile-sm"
        aria-label="Cancelar edición del stock mínimo"
        onClick={cancel}
        className="text-[var(--color-text-subtle)]"
      >
        <X size={14} />
      </Button>
    </form>
  )
}

/** Encabezado ordenable. `aria-sort` acompaña al indicador visual para que el
 *  orden no sea una señal sólo de color y forma. */
function SortableHeader({
  label, sortKey, active, dir, onSort, className,
}: {
  label: string
  sortKey: SortKey
  active: boolean
  dir: SortDir
  onSort: (key: SortKey) => void
  className?: string
}) {
  return (
    <TableHead
      scope="col"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={className}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex min-h-6 min-w-6 items-center gap-1 py-1 transition-colors hover:text-[var(--color-text)]"
      >
        {label}
        <span aria-hidden className={active ? "opacity-100" : "opacity-0"}>
          {dir === "asc" ? "↑" : "↓"}
        </span>
      </button>
    </TableHead>
  )
}

export function StockTable({ worksites, canExport, canSetMinStock = true }: StockTableProps) {
  const allItems = worksites.flatMap((ws) => ws.items)
  const lowStockCount = allItems.filter((item) => item.minStock > 0 && item.quantity <= item.minStock).length
  const noThresholds = allItems.every((item) => item.minStock === 0)
  const [groupBy, setGroupBy] = useGroupBy()
  const [collapsed, toggleCollapsed] = useCollapsedGroups()
  const [sort, setSort] = React.useState<{ key: SortKey; dir: SortDir }>({ key: "name", dir: "asc" })

  const handleSort = React.useCallback((key: SortKey) => {
    setSort((prev) => prev.key === key
      ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
      : { key, dir: key === "name" ? "asc" : "desc" })
  }, [])

  const groups = React.useMemo(
    () => buildGroups(worksites, groupBy).map((group) => ({ ...group, rows: sortRows(group.rows, sort.key, sort.dir) })),
    [worksites, groupBy, sort],
  )

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

      {/* Un aviso una vez, en vez de N celdas repitiendo "Sin mínimo": sin
          umbrales, el KPI, el badge del menú y las alertas están apagados. */}
      {noThresholds && allItems.length > 0 && canSetMinStock && (
        <p className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-5 py-2.5 text-xs text-[var(--color-text-muted)]">
          Ningún producto tiene stock mínimo definido, así que las alertas de quiebre están apagadas.{" "}
          <span className="font-medium text-[var(--color-text)]">
            Usa &quot;Registrar movimiento → Definir stock mínimo&quot; para fijarlos por faena de una vez.
          </span>
        </p>
      )}

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
                {group.rows.map(({ item: s, title, subtitle, worksiteId }) => {
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
                          <Link
                            href={`/bodega?vista=kardex&producto=${s.productId}&faena=${worksiteId}`}
                            className="text-sm font-medium text-[var(--color-text)] underline-offset-2 hover:underline"
                          >
                            {title}
                          </Link>
                          {subtitle && (
                            <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">{subtitle}</p>
                          )}
                        </div>
                        {lowStock && <Badge variant="signal" dot className="shrink-0">Bajo mínimo</Badge>}
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
                          <dd className="mt-0.5 flex justify-end">
                            <MinStockCell stockId={s.id} currentMin={s.minStock} disabled={!canSetMinStock} />
                          </dd>
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
            <TableRoot className="rounded-none border-0">
            <Table className="table-fixed text-sm">
              <caption className="sr-only">
                Stock por producto, agrupado por {groupBy === "faena" ? "faena" : "producto"}
              </caption>
              <colgroup>
                <col />
                <col className="w-32" />
                <col className="w-36" />
                <col className="w-32" />
                <col className="w-44" />
              </colgroup>
              <TableHeader>
                <TableRow className="border-b border-[var(--color-border)] text-xs uppercase tracking-wide text-[var(--color-text-subtle)]">
                  <SortableHeader
                    label={groupBy === "faena" ? "Producto" : "Faena"}
                    sortKey="name" active={sort.key === "name"} dir={sort.dir} onSort={handleSort}
                    className="px-5 py-2.5 text-left font-semibold"
                  />
                  <TableHead className="text-left font-semibold">Estado</TableHead>
                  <SortableHeader
                    label="Stock actual"
                    sortKey="quantity" active={sort.key === "quantity"} dir={sort.dir} onSort={handleSort}
                    className="px-5 py-2.5 text-right font-semibold"
                  />
                  <SortableHeader
                    label="Mínimo"
                    sortKey="minStock" active={sort.key === "minStock"} dir={sort.dir} onSort={handleSort}
                    className="px-5 py-2.5 text-right font-semibold"
                  />
                  <SortableHeader
                    label="Último movimiento"
                    sortKey="lastMovementAt" active={sort.key === "lastMovementAt"} dir={sort.dir} onSort={handleSort}
                    className="px-5 py-2.5 text-right font-semibold"
                  />
                </TableRow>
              </TableHeader>
              {groups.map((group) => {
                const isCollapsed = collapsed.has(group.id)
                return (
                  <TableBody
                    key={group.id}
                    className="divide-y divide-[var(--color-border)] border-b-2 border-[var(--color-border-strong)] last:border-b-0"
                  >
                    <TableRow>
                      <TableHead
                        scope="rowgroup"
                        colSpan={5}
                        className="bg-[var(--color-surface-2)] px-5 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]"
                      >
                        {/* Un <button> y no <details>: `details` no es válido
                            dentro de `tbody`, y el estado sobrevive al refresco
                            porque vive en sessionStorage. */}
                        <button
                          type="button"
                          onClick={() => toggleCollapsed(group.id)}
                          aria-expanded={!isCollapsed}
                          className="inline-flex min-h-6 min-w-6 items-center gap-1.5 py-1 transition-colors hover:text-[var(--color-text)]"
                        >
                          {isCollapsed ? <CaretRight size={12} weight="bold" aria-hidden /> : <CaretDown size={12} weight="bold" aria-hidden />}
                          {group.heading}
                          <span className="font-normal normal-case tracking-normal">{group.meta}</span>
                        </button>
                      </TableHead>
                    </TableRow>
                    {group.rows.map(({ item: s, title, subtitle, worksiteId }) => {
                      const lowStock = s.minStock > 0 && s.quantity <= s.minStock

                      return (
                        <TableRow key={s.id} hidden={isCollapsed} className="hover:bg-[var(--color-surface-2)] transition-colors">
                          <TableCell>
                            {/* La fila lleva a su propio kardex: antes hacer clic
                                en un producto no hacía nada. */}
                            <Link
                              href={`/bodega?vista=kardex&producto=${s.productId}&faena=${worksiteId}`}
                              className="font-medium text-[var(--color-text)] underline-offset-2 hover:underline"
                            >
                              {title}
                            </Link>
                            {subtitle && (
                              <p className="mt-0.5 font-mono text-[11px] text-[var(--color-text-subtle)]">{subtitle}</p>
                            )}
                          </TableCell>
                          {/* Sólo se rotula lo que tiene algo que decir: una
                              columna entera repitiendo "Sin mínimo" era ruido. */}
                          <TableCell>
                            {lowStock && (
                              <div className="flex flex-col items-start gap-1">
                                <Badge variant="signal" dot>Bajo mínimo</Badge>
                                {/* Detectar el quiebre y no poder pedirlo era el
                                    ciclo que quedaba abierto: el enlace abre el
                                    creador con faena, producto y déficit. */}
                                <Link
                                  href={`/solicitudes/nueva?faena=${worksiteId}&producto=${s.productId}&cantidad=${Math.max(1, Math.ceil(s.minStock - s.quantity))}`}
                                  className="text-[11px] font-medium text-[var(--color-signal-ink)] underline-offset-2 hover:underline"
                                >
                                  Reponer
                                </Link>
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="font-mono text-sm font-semibold tabular-nums text-[var(--color-text)]">
                              {formatQty(s.quantity)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <MinStockCell stockId={s.id} currentMin={s.minStock} disabled={!canSetMinStock} />
                          </TableCell>
                          <TableCell className="text-right text-xs text-[var(--color-text-subtle)]">
                            {s.lastMovementAt ? (
                              <>
                                <span className="tabular-nums">{formatDate(s.lastMovementAt)}</span>
                                <span className="mt-0.5 block text-[11px] text-[var(--color-text-faint)]">
                                  {formatDateRelative(s.lastMovementAt)}
                                </span>
                              </>
                            ) : "—"}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                )
              })}
            </Table>
            </TableRoot>
          </div>
        </>
      )}
    </section>
  )
}
