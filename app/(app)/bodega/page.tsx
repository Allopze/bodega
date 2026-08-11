import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { deliveries, deliveryItems, inventoryMovements, products, stockReturns, worksites, worksiteStock } from "@/db/schema"
import { and, eq, asc, inArray, sql, count } from "drizzle-orm"
import { requirePermission, can } from "@/lib/auth/can"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { resolvePagination } from "@/lib/pagination"
import Link from "next/link"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { Warehouse } from "@phosphor-icons/react/dist/ssr"
import { WarehouseHeaderMetrics } from "./bodega-header-metrics"
import { StockSection, KardexSection } from "./bodega-sections"
import { BodegaMovementSheet } from "./movement-sheet"
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

  const deliveryScope = isGlobalRole(session)
    ? undefined
    : visibleWsIds.length > 0
      ? inArray(deliveries.worksiteId, visibleWsIds)
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

  const [allWorksites, stockRows, recentMovements, physicalInventoryRows, returnDeliveryRows] = await Promise.all([
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
    db
      .select({
        worksiteId: worksites.id,
        worksiteName: worksites.name,
        productId: products.id,
        productName: products.name,
        productSku: products.sku,
        quantity: sql<number>`coalesce(${worksiteStock.quantity}, 0)`,
        unitOfMeasure: products.unitOfMeasure,
      })
      .from(worksites)
      .innerJoin(products, eq(products.isActive, true))
      .leftJoin(worksiteStock, and(
        eq(worksiteStock.worksiteId, worksites.id),
        eq(worksiteStock.productId, products.id),
      ))
      .where(and(eq(worksites.isActive, true), worksiteScope))
      .orderBy(asc(worksites.name), asc(products.name)),
    db
      .select({
        deliveryItemId: deliveryItems.id,
        worksiteId: worksites.id,
        worksiteName: worksites.name,
        deliveryCode: deliveries.code,
        productName: products.name,
        productSku: products.sku,
        unitOfMeasure: products.unitOfMeasure,
        remainingQuantity: sql<number>`(${deliveryItems.quantity} - coalesce(sum(${stockReturns.quantity}), 0))`,
      })
      .from(deliveryItems)
      .innerJoin(deliveries, eq(deliveryItems.deliveryId, deliveries.id))
      .innerJoin(worksites, eq(deliveries.worksiteId, worksites.id))
      .innerJoin(products, eq(deliveryItems.productId, products.id))
      .leftJoin(stockReturns, eq(stockReturns.deliveryItemId, deliveryItems.id))
      .where(and(
        eq(deliveries.destinationType, "faena"),
        eq(worksites.isActive, true),
        deliveryScope,
      ))
      .groupBy(
        deliveryItems.id,
        deliveryItems.quantity,
        worksites.id,
        worksites.name,
        deliveries.code,
        products.name,
        products.sku,
        products.unitOfMeasure,
      )
      .having(sql`${deliveryItems.quantity} > coalesce(sum(${stockReturns.quantity}), 0)`)
      .orderBy(asc(worksites.name), asc(deliveries.code), asc(products.name)),
  ])

  if (allWorksites.length === 0) {
    return (
      <PageContainer>
        <PageHeader title="Bodega" description="Control de stock e inventario."
          breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Bodega" }]} />}
        />
        <EmptyState icon={<Warehouse size={24} />} title="Sin faenas configuradas"
          description="Configura las faenas en el módulo de administración para ver el stock aquí."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/admin/faenas">Configurar faenas</Link>
            </Button>
          }
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
  const minStockDefinedCount = visibleStockRows.filter((item) => item.minStock > 0).length

  const returnProducts: ReturnPanelStockOption[] = returnDeliveryRows.map((item) => ({
    ...item,
    remainingQuantity: Number(item.remainingQuantity),
  }))

  // Sólo la faena pedida explícitamente por `?faena=` se fija arriba: el fallback
  // anterior ("la primera con stock") dejaba una faena arbitraria en cabeza y el
  // orden se leía como aleatorio. El resto lo ordena StockSection por criticidad.
  const pinnedWorksiteId = requestedWorksiteId && worksiteOptions.some((w) => w.id === requestedWorksiteId)
    ? requestedWorksiteId
    : undefined
  const adjustProducts: AdjustPanelStockOption[] = visibleStockRows.map((item) => ({
    worksiteId: item.worksiteId,
    worksiteName: item.worksite?.name ?? item.worksiteId,
    productId: item.productId,
    productName: item.product?.name ?? item.productId,
    productSku: item.product?.sku ?? null,
    unitOfMeasure: item.product?.unitOfMeasure ?? "unidad",
  }))
  const physicalInventoryProducts: PhysicalInventoryStockOption[] = physicalInventoryRows
  const showReturnPanel  = canRegisterMovements && returnProducts.length > 0 && worksiteOptions.length > 0
  const showAdjustPanel  = canAdjustStock && worksiteOptions.length > 0
  const showPhysicalInventoryPanel = canAdjustStock && physicalInventoryProducts.length > 0 && worksiteOptions.length > 0

  const stockByWorksite: Record<string, WorksiteStockWithProduct[]> = {}
  for (const s of visibleStockRows) {
    ;(stockByWorksite[s.worksiteId] ??= []).push(s)
  }

  return (
    <PageContainer>
      <PageHeader title="Bodega" description="Stock por producto y kardex de movimientos."
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Bodega" }]} />}
        headerActions={(
          <WarehouseHeaderMetrics
            worksiteCount={worksiteOptions.length}
            worksitesWithStock={worksitesWithStock.size}
            productsWithStock={productsWithStock.size}
            lowStockCount={lowStockRows.length}
            minStockDefinedCount={minStockDefinedCount}
            movementCount={kardexPagination.totalItems}
          />
        )}
        actions={
          <BodegaMovementSheet
            worksites={worksiteOptions}
            canReturn={showReturnPanel}
            returnProducts={returnProducts}
            canCount={showPhysicalInventoryPanel}
            countProducts={physicalInventoryProducts}
            canAdjust={showAdjustPanel}
            adjustProducts={adjustProducts}
          />
        }
      />
      <div className="flex flex-col gap-8">
        <StockSection
          worksites={worksiteOptions}
          stockByWorksite={stockByWorksite}
          pinnedWorksiteId={pinnedWorksiteId}
          receivingHref={canViewReceiving ? "/recepcion" : undefined}
          canExportStock={canExportStock}
          lowStockOnly={sp.stock === "low"}
        />

        <KardexSection
          movements={visibleMovements as InventoryMovementWithRelations[]}
          worksites={worksiteOptions}
          canExport={canExportStock}
          pagination={kardexPagination}
          searchParams={sp}
        />
      </div>
    </PageContainer>
  )
}
