"use client"

import Link from "next/link"
import { EmptyState } from "@/components/ui/empty-state"
import { StockTable } from "./stock-table"
import { KardexTable } from "./kardex-table"
import { ServerPagination } from "@/components/ui/server-pagination"
import { ArrowRight, Package, Warehouse, WarningCircle } from "@phosphor-icons/react/dist/ssr"
import type { WorksiteStockWithProduct, InventoryMovementWithRelations } from "./types"
import type { resolvePagination } from "@/lib/pagination"

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
  const sortedWorksites = [...worksites].sort((a, b) => {
    const aHasStock = (stockByWorksite[a.id] ?? []).some((item) => item.quantity > 0)
    const bHasStock = (stockByWorksite[b.id] ?? []).some((item) => item.quantity > 0)
    if (a.id === initialWorksiteId) return -1
    if (b.id === initialWorksiteId) return 1
    if (aHasStock !== bHasStock) return aHasStock ? -1 : 1
    return a.name.localeCompare(b.name, "es")
  })
  const worksitesWithStock = sortedWorksites
    .map((ws) => ({
      ...ws,
      items: (stockByWorksite[ws.id] ?? []).filter((item) => item.quantity > 0),
    }))
    .filter((ws) => ws.items.length > 0)
  const worksitesWithoutStock = sortedWorksites.filter((ws) => !worksitesWithStock.some((stocked) => stocked.id === ws.id))

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
      </section>
    )
  }

  return (
    <div className="space-y-6">
      <StockTable worksites={worksitesWithStock} canExport={canExportStock} />

      {worksitesWithoutStock.length > 0 && (
        <section className="border-t border-[var(--color-border)] pt-4">
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-subtle)]">
            <WarningCircle size={14} />
            <span className="font-medium">Sin stock:</span>
            <span>{worksitesWithoutStock.map((ws) => ws.name).join(", ")}</span>
          </div>
        </section>
      )}
    </div>
  )
}

export function KardexSection({
  movements,
  worksites,
  canExport,
  pagination,
  hrefForPage,
}: {
  movements: InventoryMovementWithRelations[]
  worksites: WorksiteOption[]
  canExport: boolean
  pagination: ReturnType<typeof resolvePagination>
  hrefForPage: (page: number) => string
}) {
  return (
    <>
      <KardexTable movements={movements} worksites={worksites} canExport={canExport} />
      <ServerPagination pagination={pagination} hrefForPage={hrefForPage} />
    </>
  )
}
