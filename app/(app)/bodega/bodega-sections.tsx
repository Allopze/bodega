"use client"

import Link from "next/link"
import { EmptyState } from "@/components/ui/empty-state"
import { StockTable } from "./stock-table"
import { KardexTable } from "./kardex-table"
import { ArrowRight, Package, Warehouse, WarningCircle } from "@phosphor-icons/react/dist/ssr"
import type { WorksiteStockWithProduct, InventoryMovementWithRelations } from "./types"
import { ServerPagination } from "@/components/ui/server-pagination"
import type { PaginationState } from "@/lib/pagination"

interface WorksiteOption {
  id: string
  name: string
}

export type StockState = "" | "low" | "warn"

export function StockSection({
  worksites,
  stockByWorksite,
  receivingHref,
  canExportStock,
  stockState = "",
  hasFilters = false,
  truncated = false,
  canSetMinStock = false,
}: {
  worksites: WorksiteOption[]
  stockByWorksite: Record<string, WorksiteStockWithProduct[]>
  receivingHref?: string
  canExportStock?: boolean
  /** `low` = bajo o en el mínimo · `warn` = por agotarse (bajo 1,5× el mínimo). */
  stockState?: StockState
  hasFilters?: boolean
  /** El servidor recortó las filas: hay que avisarlo, no dejar creer que es todo. */
  truncated?: boolean
  canSetMinStock?: boolean
}) {
  const isLowStock = (item: WorksiteStockWithProduct) => item.minStock > 0 && item.quantity <= item.minStock
  const isWarnStock = (item: WorksiteStockWithProduct) =>
    item.minStock > 0 && item.quantity > item.minStock && item.quantity < item.minStock * 1.5

  // En "bajo el mínimo" también entran las líneas agotadas (cantidad 0) con
  // umbral definido: son exactamente las que cuenta el KPI del encabezado y sin
  // ellas el KPI mostraba N y la vista "nada bajo el mínimo".
  const isVisibleItem = (item: WorksiteStockWithProduct) => {
    if (stockState === "low") return isLowStock(item)
    if (stockState === "warn") return isWarnStock(item)
    return item.quantity > 0
  }

  const sortedWorksites = [...worksites].sort((a, b) => {
    const aItems = stockByWorksite[a.id] ?? []
    const bItems = stockByWorksite[b.id] ?? []
    // Criticidad antes que alfabético: la faena con algo bajo mínimo va arriba.
    const aLow = aItems.some(isLowStock)
    const bLow = bItems.some(isLowStock)
    if (aLow !== bLow) return aLow ? -1 : 1
    const aHasStock = aItems.some(isVisibleItem)
    const bHasStock = bItems.some(isVisibleItem)
    if (aHasStock !== bHasStock) return aHasStock ? -1 : 1
    return a.name.localeCompare(b.name, "es")
  })

  const worksitesWithStock = sortedWorksites
    .map((ws) => ({ ...ws, items: (stockByWorksite[ws.id] ?? []).filter(isVisibleItem) }))
    .filter((ws) => ws.items.length > 0)

  // "Sin stock" es literal: la faena no tiene ninguna existencia. Se calcula
  // contra `quantity > 0` y nunca contra el filtro activo — si no, en modo bajo
  // mínimo una faena repleta pero sin nada bajo el umbral aparecería rotulada
  // "Sin stock". Y con filtros activos el pie no aplica: la lista ya no es el
  // universo de faenas sino un recorte.
  const worksitesWithoutStock = stockState || hasFilters
    ? []
    : sortedWorksites.filter((ws) => !(stockByWorksite[ws.id] ?? []).some((item) => item.quantity > 0))

  if (worksites.length === 0) {
    return (
      <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <EmptyState
          icon={<Warehouse size={24} />}
          title="Sin faenas asignadas"
          description="Tu cuenta no tiene faenas habilitadas para consultar stock."
        />
      </section>
    )
  }

  if (worksitesWithStock.length === 0) {
    return (
      <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        {hasFilters ? (
          <EmptyState
            icon={<Package size={24} />}
            title="Sin coincidencias"
            description="Ningún producto en stock coincide con los filtros aplicados."
            action={
              <Link href="/bodega" className="inline-flex h-8 items-center justify-center gap-2 rounded-[var(--radius)] bg-[var(--color-primary)] px-4 text-[13px] font-semibold text-white transition-[background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-[var(--color-primary-strong)]">
                Limpiar filtros
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={<Package size={24} />}
            title="Sin stock registrado"
            description="Los ingresos de recepción aparecerán aquí cuando una orden de compra llegue a faena."
            action={receivingHref ? (
              <Link
                href={receivingHref}
                className="inline-flex h-8 items-center justify-center gap-2 rounded-[var(--radius)] bg-[var(--color-primary)] px-4 text-[13px] font-semibold text-white transition-[background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-[var(--color-primary-strong)]"
              >
                Ver recepciones
                <ArrowRight size={14} aria-hidden />
              </Link>
            ) : undefined}
          />
        )}
      </section>
    )
  }

  return (
    <div className="space-y-4">
      <StockTable
        worksites={worksitesWithStock}
        canExport={canExportStock}
        canSetMinStock={canSetMinStock}
      />

      {truncated && (
        <div className="rounded-[var(--radius)] border border-[var(--color-signal-line)] bg-[var(--color-signal-tint)] px-3 py-2">
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-signal-ink)]">
            <WarningCircle size={13} />
            <span className="font-medium">Vista recortada:</span>
            <span>se muestran las primeras filas. Filtra por faena o producto para verlo completo.</span>
          </div>
        </div>
      )}

      {worksitesWithoutStock.length > 0 && (
        <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-subtle)]">
            <WarningCircle size={13} />
            <span className="font-medium">Sin stock:</span>
            <span>{worksitesWithoutStock.map((ws) => ws.name).join(", ")}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export function KardexSection({
  movements,
  worksites,
  canExport,
  pagination,
  searchParams,
}: {
  movements: InventoryMovementWithRelations[]
  worksites: WorksiteOption[]
  canExport: boolean
  pagination: PaginationState
  searchParams: Record<string, string | string[] | undefined>
}) {
  const searchQuery = typeof searchParams.q === "string" ? searchParams.q : ""

  const kardexHref = (page: number) => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(searchParams)) {
      if (key === "kardex_page" || value === undefined) continue
      if (Array.isArray(value)) { for (const v of value) params.append(key, v) }
      else params.set(key, value)
    }
    if (page > 1) params.set("kardex_page", String(page))
    const q = params.toString()
    return q ? `/bodega?${q}` : "/bodega"
  }

  return (
    <>
      <KardexTable
        movements={movements}
        worksites={worksites}
        canExport={canExport}
        searchQuery={searchQuery}
      />
      {/* La paginación acompaña a una tabla con filas. Sin ellas, un paginador
          suelto se lee como el pie de una tabla que no está. */}
      {movements.length > 0 && (
        <ServerPagination pagination={pagination} hrefForPage={kardexHref} />
      )}
    </>
  )
}
