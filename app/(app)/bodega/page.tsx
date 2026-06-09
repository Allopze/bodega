import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Suspense } from "react"
import { db } from "@/db"
import { deliveryItems, purchaseRequestItems, warehouses, worksites } from "@/db/schema"
import { eq, asc, inArray } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { can, canAccessWorksite } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { SkeletonPage } from "@/components/ui/skeleton"
import { Warehouse } from "@phosphor-icons/react/dist/ssr"
import { DispatchPanel } from "./dispatch-panel"
import { StockTable } from "./stock-table"
import { KardexTable } from "./kardex-table"
import type { DeliverableOption, StockOption, WorksiteOption } from "./dispatch-panel"
import type { Warehouse as WarehouseType, WarehouseStockWithProduct, InventoryMovementWithRelations } from "./types"

export const metadata: Metadata = { title: "Bodega" }

export default async function BodegaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("warehouse:view_stock") }
  catch { redirect("/dashboard") }
  const sp = await searchParams
  const requestedWorksiteId = typeof sp.faena === "string" ? sp.faena : ""
  const requestedItemId = typeof sp.item === "string" ? sp.item : ""

  const canDispatch = can(session, "warehouse:register_movement")

  const [allWarehouses, allWorksites] = await Promise.all([
    db.select().from(warehouses).where(eq(warehouses.isActive, true)).orderBy(asc(warehouses.name)),
    db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(eq(worksites.isActive, true)).orderBy(asc(worksites.name)),
  ])

  if (allWarehouses.length === 0) {
    return (
      <>
        <PageHeader title="Bodega" description="Control de stock e inventario."
          breadcrumb={<Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Bodega" }]} />}
        />
        <EmptyState icon={<Warehouse size={24} />} title="Sin bodegas configuradas"
          description="Configura las bodegas en el módulo de administración para ver el stock aquí."
        />
      </>
    )
  }

  const warehouseIds = allWarehouses.map((w) => w.id)

  const [stockRows, recentMovements, receivedItems] = await Promise.all([
    db.query.warehouseStock.findMany({
      where: (s, { inArray }) => inArray(s.warehouseId, warehouseIds),
      with: { product: true, warehouse: true },
      orderBy: (s, { asc }) => [asc(s.warehouseId)],
    }),
    db.query.inventoryMovements.findMany({
      where: (m, { inArray }) => inArray(m.warehouseId, warehouseIds),
      with: { product: true, warehouse: true },
      orderBy: (m, { desc }) => [desc(m.performedAt)],
      limit: 50,
    }),
    db.query.purchaseRequestItems.findMany({
      where: inArray(purchaseRequestItems.status, ["received", "partially_delivered"]),
      with: { product: true, request: true },
    }),
  ])

  const stockOptions: StockOption[] = stockRows
    .filter((s) => s.quantity > 0)
    .map((s) => ({
      warehouseId: s.warehouseId, warehouseName: s.warehouse?.name ?? s.warehouseId,
      productId: s.productId, productName: s.product?.name ?? s.productId,
      productSku: s.product?.sku ?? null, quantity: s.quantity,
      unitOfMeasure: s.product?.unitOfMeasure ?? "unidad",
    }))
  const worksiteOptions: WorksiteOption[] = allWorksites
    .filter((w) => canAccessWorksite(session, w.id))
    .map((w) => ({ id: w.id, name: w.name }))
  const requestItemIds = receivedItems.map((item) => item.id)
  const deliveredRows = requestItemIds.length > 0
    ? await db.select({ requestItemId: deliveryItems.requestItemId, quantity: deliveryItems.quantity })
        .from(deliveryItems).where(inArray(deliveryItems.requestItemId, requestItemIds))
    : []
  const deliveredByItem = new Map<string, number>()
  for (const row of deliveredRows) {
    if (!row.requestItemId) continue
    deliveredByItem.set(row.requestItemId, (deliveredByItem.get(row.requestItemId) ?? 0) + row.quantity)
  }
  const deliverableOptions: DeliverableOption[] = receivedItems
    .filter((item) => item.productId !== null && canAccessWorksite(session, item.request.worksiteId))
    .map((item) => {
      const deliveredQuantity = deliveredByItem.get(item.id) ?? 0
      return {
        requestItemId: item.id, requestCode: item.request.code, worksiteId: item.request.worksiteId,
        productId: item.productId as string, productName: item.product?.name ?? item.productNameFree ?? "Ítem recibido",
        quantity: item.quantity, deliveredQuantity, remainingQuantity: Math.max(0, item.quantity - deliveredQuantity),
        unitOfMeasure: item.unitOfMeasure,
      }
    }).filter((item) => item.remainingQuantity > 0)
  const initialDeliverable = requestedItemId
    ? deliverableOptions.find((item) => item.requestItemId === requestedItemId) : undefined
  const initialWorksiteId = initialDeliverable?.worksiteId
    ?? (worksiteOptions.some((w) => w.id === requestedWorksiteId) ? requestedWorksiteId : undefined)
  const initialProductId = initialDeliverable?.productId
  const initialWarehouseId = initialProductId
    ? stockOptions.find((s) => s.productId === initialProductId)?.warehouseId : undefined

  const stockByWarehouse: Record<string, typeof stockRows> = {}
  for (const s of stockRows) {
    if (!stockByWarehouse[s.warehouseId]) stockByWarehouse[s.warehouseId] = []
    stockByWarehouse[s.warehouseId].push(s)
  }

  return (
    <>
      <PageHeader title="Bodega" description="Stock por producto y kardex de movimientos."
        breadcrumb={<Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Bodega" }]} />}
      />
      <div className="flex flex-col gap-8">
        <Suspense fallback={<SkeletonPage rows={6} />}>
          <StockSection warehouses={allWarehouses} stockByWarehouse={stockByWarehouse} />
        </Suspense>

        {canDispatch && stockOptions.length > 0 && worksiteOptions.length > 0 && (
          <div className="max-w-2xl">
            <DispatchPanel stockItems={stockOptions} worksites={worksiteOptions} deliverableItems={deliverableOptions}
              initialWarehouseId={initialWarehouseId} initialWorksiteId={initialWorksiteId}
              initialProductId={initialProductId} initialRequestItemId={initialDeliverable?.requestItemId}
            />
          </div>
        )}

        <Suspense fallback={<SkeletonPage rows={6} />}>
          <KardexSection movements={recentMovements} />
        </Suspense>
      </div>
    </>
  )
}

function StockSection({ warehouses, stockByWarehouse }: {
  warehouses: WarehouseType[]
  stockByWarehouse: Record<string, WarehouseStockWithProduct[]>
}) {
  return (
    <>
      {warehouses.map((warehouse) => (
        <StockTable key={warehouse.id} warehouse={warehouse}
          items={stockByWarehouse[warehouse.id] ?? []} />
      ))}
    </>
  )
}

function KardexSection({ movements }: { movements: InventoryMovementWithRelations[] }) {
  return <KardexTable movements={movements} />
}
