"use client"

import Link from "next/link"
import { EmptyState } from "@/components/ui/empty-state"
import { StockTable } from "./stock-table"
import { KardexTable } from "./kardex-table"
import { ArrowRight, Package, Warehouse, WarningCircle } from "@phosphor-icons/react/dist/ssr"
import type { WorksiteStockWithProduct, InventoryMovementWithRelations } from "./types"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { filterStockItems, filterMovements } from "./filters"
import { ServerPagination } from "@/components/ui/server-pagination"
import type { PaginationState } from "@/lib/pagination"

interface WorksiteOption {
  id: string
  name: string
}

export function StockSection({ worksites, stockByWorksite, initialWorksiteId, receivingHref, canExportStock }: {
  worksites: WorksiteOption[]
  stockByWorksite: Record<string, WorksiteStockWithProduct[]>
  initialWorksiteId?: string
  receivingHref?: string
  canExportStock?: boolean
}) {
  const { searchQuery } = useSafeShellHeader()

  const sortedWorksites = [...worksites].sort((a, b) => {
    const aHasStock = (stockByWorksite[a.id] ?? []).some((item) => item.quantity > 0)
    const bHasStock = (stockByWorksite[b.id] ?? []).some((item) => item.quantity > 0)
    if (a.id === initialWorksiteId) return -1
    if (b.id === initialWorksiteId) return 1
    if (aHasStock !== bHasStock) return aHasStock ? -1 : 1
    return a.name.localeCompare(b.name, "es")
  })
  // Faenas that genuinely have stock — independent of the search query, so
  // the "Sin stock" footer below never mislabels a faena that has stock but
  // didn't match the current search.
  const worksitesWithAnyStock = sortedWorksites
    .map((ws) => ({ ...ws, items: (stockByWorksite[ws.id] ?? []).filter((item) => item.quantity > 0) }))
    .filter((ws) => ws.items.length > 0)
  const worksitesWithoutStock = sortedWorksites.filter((ws) => !worksitesWithAnyStock.some((stocked) => stocked.id === ws.id))
  const worksitesWithStock = worksitesWithAnyStock
    .map((ws) => ({ ...ws, items: filterStockItems(ws.items, searchQuery) }))
    .filter((ws) => ws.items.length > 0)

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
        {searchQuery.trim() ? (
          <EmptyState
            icon={<Package size={24} />}
            title="Sin coincidencias"
            description={`Ningún producto en stock coincide con "${searchQuery.trim()}".`}
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
      <StockTable worksites={worksitesWithStock} canExport={canExportStock} />

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
  const { searchQuery } = useSafeShellHeader()
  // ponytail: kardex is server-paginated, so this only filters the movements
  // already loaded on the current page — a match on an older page won't show
  // up. Move to a server-side ilike (like lib/adquisiciones/list-query.ts's
  // textSearchSql) if that gap becomes a real complaint.
  const filteredMovements = filterMovements(movements, searchQuery)

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
      <KardexTable movements={filteredMovements} worksites={worksites} canExport={canExport} />
      <ServerPagination pagination={pagination} hrefForPage={kardexHref} />
    </>
  )
}
