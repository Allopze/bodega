"use client"

import * as React from "react"
import Link from "next/link"
import { CaretDown, CaretRight, ClockCounterClockwise, Info } from "@phosphor-icons/react"
import type { WorksiteStockWithProduct } from "./types"
import { EmptyState } from "@/components/ui/empty-state"
import { cn, formatQty, formatDate, formatDateRelative } from "@/lib/utils"
import { StockExportButton } from "./stock-export-button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { Tooltip } from "@/components/ui/tooltip"
import { StockRowMenu, productMovementsHref } from "./stock-row-menu"

export interface StockTableProps {
  worksites: Array<{
    id: string
    name: string
    items: WorksiteStockWithProduct[]
  }>
  canExport?: boolean
  /** Permisos que habilitan el menú de cada fila. Sin ninguno no hay columna. */
  canDeliver?: boolean
  canAdjust?: boolean
}

type GroupBy = "faena" | "producto"
type SortKey = "name" | "quantity" | "lastMovementAt"
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
const INCOMING_DEFINITION =
  "Lo aprobado en solicitudes que todavía no llega a esta faena. Si ya está en la oficina, sigue contando hasta que llegue."

/**
 * `sessionStorage` y no la URL: agrupar es preferencia de vista y se aplica en
 * cliente sobre filas ya cargadas. En la URL obligaría a un viaje al servidor, y
 * en estado de React sola se perdería al recargar o al volver a Bodega desde
 * otra pantalla (hasta 2026-09-24 la borraba también cada revalidación, que
 * volvía a montar la plataforma entera).
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
        // `uppercase` explícito: el navegador no le hereda `text-transform` a un
        // <button>, y sin él estas columnas salían en minúscula junto a las demás.
        className="inline-flex min-h-6 min-w-6 items-center gap-1 py-1 uppercase transition-colors hover:text-[var(--color-text)]"
      >
        {label}
        <span aria-hidden className={active ? "opacity-100" : "opacity-0"}>
          {dir === "asc" ? "↑" : "↓"}
        </span>
      </button>
    </TableHead>
  )
}

function AvailabilityDefinition({
  label,
  definition,
  className,
}: {
  label: string
  definition: string
  className?: string
}) {
  return (
    <span className={["inline-flex items-center gap-1", className].filter(Boolean).join(" ")}>
      {label}
      <Tooltip content={definition} side="top">
        <button
          type="button"
          aria-label={`Qué significa ${label}`}
          // `-my-3`: el área táctil de 44 px se queda, pero sin agrandar el
          // rótulo; si no, en la tarjeta el valor caía más abajo que su vecino.
          className="-my-3 inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] transition-colors hover:text-[var(--color-text)] focus-visible:text-[var(--color-text)] md:my-0 md:min-h-6 md:min-w-6"
        >
          <Info size={13} aria-hidden />
        </button>
      </Tooltip>
    </span>
  )
}

/**
 * Nombre del producto como enlace a sus movimientos. El subrayado sólo al pasar
 * el cursor no se descubría ni con teclado ni en el celular: el ícono de reloj
 * dice qué hay al otro lado.
 */
function ProductName({
  item, title, worksiteId, muted, className,
}: {
  item: WorksiteStockWithProduct
  title: string
  worksiteId: string
  muted: boolean
  className?: string
}) {
  const tone = muted ? "text-[var(--color-text-muted)]" : "text-[var(--color-text)]"
  if (!item.hasStockRecord) {
    return <span className={cn("font-medium", tone, className)}>{title}</span>
  }
  return (
    <Link
      href={productMovementsHref(item.productId, worksiteId)}
      title={`Ver movimientos de ${title}`}
      className={cn("group/product inline-flex items-center gap-1.5 font-medium underline-offset-2 hover:underline", tone, className)}
    >
      {title}
      <ClockCounterClockwise
        size={12}
        aria-hidden
        className="shrink-0 text-[var(--color-text-faint)] transition-colors group-hover/product:text-[var(--color-text)]"
      />
    </Link>
  )
}

function AvailabilityHeader({ label, definition }: { label: string; definition: string }) {
  return (
    <TableHead aria-label={label} className="text-right font-semibold">
      <AvailabilityDefinition label={label} definition={definition} className="justify-end" />
    </TableHead>
  )
}

export function StockTable({ worksites, canExport, canDeliver = false, canAdjust = false }: StockTableProps) {
  const hasRowActions = canDeliver || canAdjust
  const allItems = worksites.flatMap((ws) => ws.items)
  const productCount = new Set(allItems.map((item) => item.productId)).size
  const incomingOnlyCount = allItems.filter((item) => item.quantity <= 0 && item.incoming > 0).length
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
          {/* Productos distintos, no filas: un mismo producto aparece en varias
              faenas. Lo que sólo está por recibir se cuenta aparte, porque el
              KPI "Productos con stock" del encabezado no lo incluye. */}
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {productCount} {productCount === 1 ? "producto" : "productos"} en {worksites.length} {worksites.length === 1 ? "faena" : "faenas"}
            {incomingOnlyCount > 0 && ` · ${incomingOnlyCount} sólo por recibir`}
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
          {/* Sin tarjetas con borde dentro de la sección: una tarjeta redondeada
              dentro de otra redondeada y con borde leía como un marco doble.
              Cada producto es una fila de lista separada por una línea. */}
          <div className="md:hidden">
            {groups.map((group) => (
              <div key={group.id}>
                <h3 className="border-y border-[var(--color-border)] bg-[var(--color-surface-2)] px-5 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)] first:border-t-0">
                  {group.heading}
                  <span className="ml-2 font-normal normal-case tracking-normal">{group.meta}</span>
                </h3>
                <div className="divide-y divide-[var(--color-border)]">
                {group.rows.map(({ item: s, title, subtitle, worksiteId }) => {
                  const unit = s.product?.unitOfMeasure ?? "u"
                  const empty = s.quantity <= 0

                  return (
                    <article key={s.id} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <ProductName item={s} title={title} worksiteId={worksiteId} muted={empty} className="text-sm" />
                          {subtitle && (
                            <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">{subtitle}</p>
                          )}
                        </div>
                        {hasRowActions && (
                          <StockRowMenu
                            productId={s.productId}
                            productName={s.product?.name ?? title}
                            worksiteId={worksiteId}
                            hasStockRecord={s.hasStockRecord}
                            canDeliver={canDeliver && !empty}
                            canAdjust={canAdjust}
                          />
                        )}
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                        <div>
                          <dt className="text-[var(--color-text-subtle)]">En bodega</dt>
                          <dd className={cn(
                            "mt-0.5 font-mono text-sm tabular-nums",
                            empty ? "font-normal text-[var(--color-text-faint)]" : "font-semibold text-[var(--color-text)]",
                          )}>
                            {formatQty(s.quantity, unit)}
                          </dd>
                        </div>
                        <div className="text-right">
                          <dt className="text-[var(--color-text-subtle)]">
                            <AvailabilityDefinition
                              label="Por recibir"
                              definition={INCOMING_DEFINITION}
                              className="w-full justify-end"
                            />
                          </dt>
                          <dd className="mt-0.5 font-mono text-sm tabular-nums text-[var(--color-text)]">
                            {formatQty(s.incoming, unit)}
                          </dd>
                        </div>
                        <div>
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
              </div>
            ))}
          </div>

          {/* Una sola <table> para todas las faenas: con una por faena, cada una
              calculaba sus anchos `auto` por separado y las cantidades quedaban
              desalineadas entre grupos. Los anchos viven en el <colgroup>. */}
          <div className="hidden md:block">
            <TableRoot className="rounded-none border-0">
            <Table className="min-w-[768px] table-fixed text-sm">
              <caption className="sr-only">
                Stock por producto, agrupado por {groupBy === "faena" ? "faena" : "producto"}
              </caption>
              <colgroup>
                <col className="w-80" />
                <col className="w-32" />
                <col className="w-36" />
                <col className="w-44" />
                {hasRowActions && <col className="w-14" />}
              </colgroup>
              <TableHeader>
                <TableRow className="border-b border-[var(--color-border)] text-xs uppercase tracking-wide text-[var(--color-text-subtle)]">
                  <SortableHeader
                    label={groupBy === "faena" ? "Producto" : "Faena"}
                    sortKey="name" active={sort.key === "name"} dir={sort.dir} onSort={handleSort}
                    className="px-5 py-2.5 text-left font-semibold"
                  />
                  <SortableHeader
                    label="En bodega"
                    sortKey="quantity" active={sort.key === "quantity"} dir={sort.dir} onSort={handleSort}
                    className="px-5 py-2.5 text-right font-semibold"
                  />
                  <AvailabilityHeader label="Por recibir" definition={INCOMING_DEFINITION} />
                  <SortableHeader
                    label="Último movimiento"
                    sortKey="lastMovementAt" active={sort.key === "lastMovementAt"} dir={sort.dir} onSort={handleSort}
                    className="px-5 py-2.5 text-right font-semibold"
                  />
                  {hasRowActions && (
                    <TableHead scope="col" className="px-2 py-2.5">
                      <span className="sr-only">Acciones</span>
                    </TableHead>
                  )}
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
                        colSpan={hasRowActions ? 5 : 4}
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
                      // En cero (sólo por recibir o agotado): se lee como lo que
                      // es, ausencia, y no compite con lo que sí hay.
                      const empty = s.quantity <= 0
                      return (
                      <TableRow key={s.id} hidden={isCollapsed} className="hover:bg-[var(--color-surface-2)] transition-colors">
                        <TableCell>
                          {/* La fila lleva a su propio kardex: antes hacer clic
                              en un producto no hacía nada. Lo que nunca entró
                              a la faena no tiene movimientos que mostrar. */}
                          <ProductName item={s} title={title} worksiteId={worksiteId} muted={empty} />
                          {subtitle && (
                            <p className="mt-0.5 font-mono text-[11px] text-[var(--color-text-subtle)]">{subtitle}</p>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={cn(
                            "font-mono text-sm tabular-nums",
                            empty ? "font-normal text-[var(--color-text-faint)]" : "font-semibold text-[var(--color-text)]",
                          )}>
                            {formatQty(s.quantity)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm tabular-nums">
                          {formatQty(s.incoming)}
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
                        {hasRowActions && (
                          <TableCell className="px-2 text-right">
                            <StockRowMenu
                              productId={s.productId}
                              productName={s.product?.name ?? title}
                              worksiteId={worksiteId}
                              hasStockRecord={s.hasStockRecord}
                              canDeliver={canDeliver && !empty}
                              canAdjust={canAdjust}
                            />
                          </TableCell>
                        )}
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
