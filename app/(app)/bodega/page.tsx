import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Suspense } from "react"
import { db } from "@/db"
import { inventoryMovements, worksites } from "@/db/schema"
import { and, eq, asc, inArray, sql, count } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { can } from "@/lib/auth/can"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { ServerPagination } from "@/components/ui/server-pagination"
import { resolvePagination } from "@/lib/pagination"
import { EmptyState } from "@/components/ui/empty-state"
import { SkeletonPage } from "@/components/ui/skeleton"
import { ArrowRight, Package, Warehouse, WarningCircle } from "@phosphor-icons/react/dist/ssr"
import { ReturnPanel } from "./return-panel"
import { AdjustPanel } from "./adjust-panel"
import { StockTable } from "./stock-table"
import { KardexTable } from "./kardex-table"
import type { ReturnPanelStockOption } from "./return-panel"
import type { AdjustPanelStockOption } from "./adjust-panel"
import type { WorksiteStockWithProduct, InventoryMovementWithRelations } from "./types"

export const metadata: Metadata = { title: "Bodega" }

import { KARDEX_PAGE_SIZE } from "@/lib/constants"

interface WorksiteOption {
  id: string
  name: string
}

export default async function BodegaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("warehouse:view_stock") }
  catch { redirect("/forbidden") }
  const sp = await searchParams
  const requestedWorksiteId = typeof sp.faena === "string" ? sp.faena : ""

  const canRegisterMovements = can(session, "warehouse:register_movement")
  const canAdjustStock       = can(session, "warehouse:adjust_stock")
  const canViewReceiving     = can(session, "receiving:view")
  const canExportStock       = can(session, "warehouse:view_stock")
  const visibleWsIds = visibleWorksiteIds(session)
  const worksiteScope = isGlobalRole(session)
    ? undefined
    : visibleWsIds.length > 0
      ? inArray(worksites.id, visibleWsIds)
      : sql`false`

  const movementScope = isGlobalRole(session)
    ? undefined
    : visibleWsIds.length > 0
      ? inArray(inventoryMovements.worksiteId, visibleWsIds)
      : sql`false`

  // Kardex pagination
  const [movementTotalRow] = await db
    .select({ total: count() })
    .from(inventoryMovements)
    .where(movementScope)

  const kardexPagination = resolvePagination({
    pageParam: sp.kardex_page,
    totalItems: movementTotalRow?.total ?? 0,
    pageSize: KARDEX_PAGE_SIZE,
  })

  const kardexHref = (page: number) => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(sp)) {
      if (key === "kardex_page" || value === undefined) continue
      if (Array.isArray(value)) { for (const v of value) params.append(key, v) }
      else params.set(key, value)
    }
    if (page > 1) params.set("kardex_page", String(page))
    const q = params.toString()
    return q ? `/bodega?${q}` : "/bodega"
  }

  const [allWorksites, stockRows, recentMovements] = await Promise.all([
    db
      .select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .where(and(eq(worksites.isActive, true), worksiteScope))
      .orderBy(asc(worksites.name)),
    db.query.worksiteStock.findMany({
      with: { product: true, worksite: true },
      where: isGlobalRole(session)
        ? undefined
        : (s, { inArray }) => visibleWsIds.length > 0 ? inArray(s.worksiteId, visibleWsIds) : sql`false`,
      orderBy: (s, { asc }) => [asc(s.worksiteId)],
    }),
    db.query.inventoryMovements.findMany({
      with: { product: true, worksite: true },
      where: isGlobalRole(session)
        ? undefined
        : (m, { inArray }) => visibleWsIds.length > 0 ? inArray(m.worksiteId, visibleWsIds) : sql`false`,
      orderBy: (m, { desc }) => [desc(m.performedAt)],
      limit: kardexPagination.limit,
      offset: kardexPagination.offset,
    }),
  ])

  if (allWorksites.length === 0) {
    return (
      <PageContainer>
        <PageHeader title="Bodega" description="Control de stock e inventario."
          breadcrumb={<Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Bodega" }]} />}
        />
        <EmptyState icon={<Warehouse size={24} />} title="Sin faenas configuradas"
          description="Configura las faenas en el módulo de administración para ver el stock aquí."
        />
      </PageContainer>
    )
  }

  const worksiteOptions: WorksiteOption[] = allWorksites.map((w) => ({ id: w.id, name: w.name }))
  const visibleStockRows = stockRows
  const visibleMovements = recentMovements
  const stockWithQuantity = visibleStockRows.filter((item) => item.quantity > 0)
  const worksitesWithStock = new Set(stockWithQuantity.map((item) => item.worksiteId))
  const productsWithStock = new Set(stockWithQuantity.map((item) => item.productId))
  const lowStockRows = visibleStockRows.filter((item) => item.minStock > 0 && item.quantity <= item.minStock)

  const returnProducts: ReturnPanelStockOption[] = visibleStockRows
    .map((s) => ({
      worksiteId: s.worksiteId,
      worksiteName: s.worksite?.name ?? s.worksiteId,
      productId: s.productId,
      productName: s.product?.name ?? s.productId,
      productSku: s.product?.sku ?? null,
      unitOfMeasure: s.product?.unitOfMeasure ?? "unidad",
    }))

  const firstStockWorksiteId = visibleStockRows.find((item) => item.quantity > 0)?.worksiteId
  const initialWorksiteId = (requestedWorksiteId && worksiteOptions.some((w) => w.id === requestedWorksiteId) ? requestedWorksiteId : undefined)
    ?? firstStockWorksiteId
    ?? worksiteOptions[0]?.id
  const adjustProducts: AdjustPanelStockOption[] = returnProducts
  const showReturnPanel  = canRegisterMovements && returnProducts.length > 0 && worksiteOptions.length > 0
  const showAdjustPanel  = canAdjustStock && worksiteOptions.length > 0

  const stockByWorksite: Record<string, WorksiteStockWithProduct[]> = {}
  for (const s of visibleStockRows) {
    ;(stockByWorksite[s.worksiteId] ??= []).push(s)
  }

  return (
    <PageContainer>
      <PageHeader title="Bodega" description="Stock por producto y kardex de movimientos."
        breadcrumb={<Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Bodega" }]} />}
        headerActions={(
          <WarehouseHeaderMetrics
            worksiteCount={worksiteOptions.length}
            worksitesWithStock={worksitesWithStock.size}
            productsWithStock={productsWithStock.size}
            lowStockCount={lowStockRows.length}
            movementCount={kardexPagination.totalItems}
          />
        )}
      />
      <div className={(showReturnPanel || showAdjustPanel) ? "grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start" : "flex flex-col gap-8"}>
        <div className="min-w-0 space-y-8">
          <Suspense fallback={<SkeletonPage rows={6} />}>
            <StockSection
              worksites={worksiteOptions}
              stockByWorksite={stockByWorksite}
              initialWorksiteId={initialWorksiteId}
              receivingHref={canViewReceiving ? "/recepcion" : undefined}
              canExportStock={canExportStock}
            />
          </Suspense>

          <Suspense fallback={<SkeletonPage rows={6} />}>
            <KardexSection
              movements={visibleMovements as InventoryMovementWithRelations[]}
              worksites={worksiteOptions}
              canExport={canExportStock}
              pagination={kardexPagination}
              hrefForPage={kardexHref}
            />
          </Suspense>
        </div>

        {(showReturnPanel || showAdjustPanel) && (
          <aside className="xl:sticky xl:top-6 flex flex-col gap-6">
            {showReturnPanel && (
              <ReturnPanel products={returnProducts} worksites={worksiteOptions} />
            )}
            {showAdjustPanel && (
              <AdjustPanel products={adjustProducts} worksites={worksiteOptions} />
            )}
          </aside>
        )}
      </div>
    </PageContainer>
  )
}

function WarehouseHeaderMetrics({
  worksiteCount,
  worksitesWithStock,
  productsWithStock,
  lowStockCount,
  movementCount,
}: {
  worksiteCount: number
  worksitesWithStock: number
  productsWithStock: number
  lowStockCount: number
  movementCount: number
}) {
  const stats: Array<{ label: string; value: string; tone?: "signal" }> = [
    { label: "Faenas con stock", value: `${worksitesWithStock}/${worksiteCount}` },
    { label: "Productos activos", value: productsWithStock.toLocaleString("es-CL") },
    { label: "Bajo mínimo", value: lowStockCount.toLocaleString("es-CL"), tone: lowStockCount > 0 ? "signal" : undefined },
    { label: "Movimientos", value: movementCount.toLocaleString("es-CL") },
  ]

  return (
    <div className="flex items-center gap-3 whitespace-nowrap text-xs">
      {stats.map((stat, i) => (
        <div key={stat.label} className="flex items-center gap-2">
          {i > 0 && (
            <span className="text-[var(--color-border-strong)]" aria-hidden>·</span>
          )}
          <span className="text-[var(--color-text-muted)]">{stat.label}</span>
          <span
            className={[
              "font-mono font-semibold tabular-nums",
              stat.tone === "signal" ? "text-[var(--color-signal-ink)]" : "text-[var(--color-text)]",
            ].join(" ")}
          >
            {stat.value}
          </span>
        </div>
      ))}
    </div>
  )
}

function StockSection({ worksites, stockByWorksite, initialWorksiteId, receivingHref, canExportStock }: {
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

function KardexSection({
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
