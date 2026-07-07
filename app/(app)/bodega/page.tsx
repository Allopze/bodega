import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { inventoryMovements, worksites } from "@/db/schema"
import { and, eq, asc, inArray, sql, count } from "drizzle-orm"
import { requirePermission, can } from "@/lib/auth/can"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { resolvePagination } from "@/lib/pagination"
import { EmptyState } from "@/components/ui/empty-state"
import { Warehouse } from "@phosphor-icons/react/dist/ssr"
import { ReturnPanel } from "./return-panel"
import { WarehouseHeaderMetrics } from "./bodega-header-metrics"
import { StockSection, KardexSection } from "./bodega-sections"
import { AdjustPanel } from "./adjust-panel"
import { PhysicalInventoryPanel } from "./physical-inventory-panel"
import type { ReturnPanelStockOption } from "./return-panel"
import type { AdjustPanelStockOption } from "./adjust-panel"
import type { PhysicalInventoryStockOption } from "./physical-inventory-panel"
import type { WorksiteStockWithProduct, InventoryMovementWithRelations } from "./types"
import { KARDEX_PAGE_SIZE } from "@/lib/constants"

export const metadata: Metadata = { title: "Bodega" }

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

  const worksiteOptions = allWorksites.map((w) => ({ id: w.id, name: w.name }))
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
  const physicalInventoryProducts: PhysicalInventoryStockOption[] = visibleStockRows
    .map((s) => ({
      worksiteId: s.worksiteId,
      worksiteName: s.worksite?.name ?? s.worksiteId,
      productId: s.productId,
      productName: s.product?.name ?? s.productId,
      productSku: s.product?.sku ?? null,
      quantity: s.quantity,
      unitOfMeasure: s.product?.unitOfMeasure ?? "unidad",
    }))
  const showReturnPanel  = canRegisterMovements && returnProducts.length > 0 && worksiteOptions.length > 0
  const showAdjustPanel  = canAdjustStock && worksiteOptions.length > 0
  const showPhysicalInventoryPanel = canAdjustStock && physicalInventoryProducts.some((item) => item.quantity > 0) && worksiteOptions.length > 0

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
      <div className={(showReturnPanel || showAdjustPanel || showPhysicalInventoryPanel) ? "grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start" : "flex flex-col gap-8"}>
        <div className="min-w-0 space-y-8">
          <StockSection
            worksites={worksiteOptions}
            stockByWorksite={stockByWorksite}
            initialWorksiteId={initialWorksiteId}
            receivingHref={canViewReceiving ? "/recepcion" : undefined}
            canExportStock={canExportStock}
          />

          <KardexSection
            movements={visibleMovements as InventoryMovementWithRelations[]}
            worksites={worksiteOptions}
            canExport={canExportStock}
            pagination={kardexPagination}
            searchParams={sp}
          />
        </div>

        {(showReturnPanel || showAdjustPanel || showPhysicalInventoryPanel) && (
          <aside className="xl:sticky xl:top-6 flex flex-col gap-6">
            {showReturnPanel && (
              <ReturnPanel products={returnProducts} worksites={worksiteOptions} />
            )}
            {showPhysicalInventoryPanel && (
              <PhysicalInventoryPanel products={physicalInventoryProducts} worksites={worksiteOptions} />
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


