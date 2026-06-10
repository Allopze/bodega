import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Suspense } from "react"
import { db } from "@/db"
import { deliveryItems, purchaseRequestItems, worksites } from "@/db/schema"
import { eq, asc, inArray } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { can, canAccessWorksite } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { SkeletonPage } from "@/components/ui/skeleton"
import { Warehouse } from "@phosphor-icons/react/dist/ssr"
import { DispatchPanel } from "./dispatch-panel"
import { ReturnPanel } from "./return-panel"
import { StockTable } from "./stock-table"
import { KardexTable } from "./kardex-table"
import type { DeliverableOption, StockOption, WorksiteOption } from "./dispatch-panel"
import type { ReturnPanelStockOption } from "./return-panel"
import type { WorksiteStockWithProduct, InventoryMovementWithRelations } from "./types"

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

  const [allWorksites, stockRows, recentMovements, receivedItems] = await Promise.all([
    db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(eq(worksites.isActive, true)).orderBy(asc(worksites.name)),
    db.query.worksiteStock.findMany({
      with: { product: true, worksite: true },
      orderBy: (s, { asc }) => [asc(s.worksiteId)],
    }),
    db.query.inventoryMovements.findMany({
      with: { product: true, worksite: true },
      orderBy: (m, { desc }) => [desc(m.performedAt)],
      limit: 50,
    }),
    db.query.purchaseRequestItems.findMany({
      where: inArray(purchaseRequestItems.status, ["received", "partially_delivered"]),
      with: { product: true, request: true },
    }),
  ])

  if (allWorksites.length === 0) {
    return (
      <>
        <PageHeader title="Bodega" description="Control de stock e inventario."
          breadcrumb={<Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Bodega" }]} />}
        />
        <EmptyState icon={<Warehouse size={24} />} title="Sin faenas configuradas"
          description="Configura las faenas en el módulo de administración para ver el stock aquí."
        />
      </>
    )
  }

  const worksiteOptions: WorksiteOption[] = allWorksites
    .filter((w) => canAccessWorksite(session, w.id))
    .map((w) => ({ id: w.id, name: w.name }))

  const stockOptions: StockOption[] = stockRows
    .filter((s) => s.quantity > 0)
    .map((s) => ({
      worksiteId: s.worksiteId, worksiteName: s.worksite?.name ?? s.worksiteId,
      productId: s.productId, productName: s.product?.name ?? s.productId,
      productSku: s.product?.sku ?? null, quantity: s.quantity,
      unitOfMeasure: s.product?.unitOfMeasure ?? "unidad",
    }))

  const returnProducts: ReturnPanelStockOption[] = stockRows
    .map((s) => ({
      worksiteId: s.worksiteId,
      worksiteName: s.worksite?.name ?? s.worksiteId,
      productId: s.productId,
      productName: s.product?.name ?? s.productId,
      productSku: s.product?.sku ?? null,
      unitOfMeasure: s.product?.unitOfMeasure ?? "unidad",
    }))

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
  const firstStockWorksiteId = stockOptions.find((item) => worksiteOptions.some((w) => w.id === item.worksiteId))?.worksiteId
  const initialWorksiteId = initialDeliverable?.worksiteId
    ?? (requestedWorksiteId && worksiteOptions.some((w) => w.id === requestedWorksiteId) ? requestedWorksiteId : undefined)
    ?? firstStockWorksiteId
    ?? deliverableOptions[0]?.worksiteId
    ?? worksiteOptions[0]?.id
  const initialProductId = initialDeliverable?.productId
    ?? stockOptions.find((item) => item.worksiteId === initialWorksiteId)?.productId
  const showDispatchPanel = canDispatch && stockOptions.length > 0 && worksiteOptions.length > 0
  const showReturnPanel = canDispatch && returnProducts.length > 0 && worksiteOptions.length > 0

  const stockByWorksite: Record<string, WorksiteStockWithProduct[]> = {}
  for (const s of stockRows) {
    if (!stockByWorksite[s.worksiteId]) stockByWorksite[s.worksiteId] = []
    stockByWorksite[s.worksiteId].push(s)
  }

  return (
    <>
      <PageHeader title="Bodega" description="Stock por producto y kardex de movimientos."
        breadcrumb={<Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Bodega" }]} />}
      />
      <div className="flex flex-col gap-6">
        <Suspense fallback={<SkeletonPage rows={6} />}>
          <StockSection worksites={worksiteOptions} stockByWorksite={stockByWorksite} initialWorksiteId={initialWorksiteId} />
        </Suspense>

        {(showDispatchPanel || showReturnPanel) && (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 xl:items-start">
            {showDispatchPanel && (
              <DispatchPanel stockItems={stockOptions} worksites={worksiteOptions} deliverableItems={deliverableOptions}
                initialWorksiteId={initialWorksiteId}
                initialProductId={initialProductId} initialRequestItemId={initialDeliverable?.requestItemId}
              />
            )}

            {showReturnPanel && (
              <ReturnPanel products={returnProducts} worksites={worksiteOptions} />
            )}
          </div>
        )}

        <Suspense fallback={<SkeletonPage rows={6} />}>
          <KardexSection movements={recentMovements as InventoryMovementWithRelations[]} />
        </Suspense>
      </div>
    </>
  )
}

function StockSection({ worksites, stockByWorksite, initialWorksiteId }: {
  worksites: WorksiteOption[]
  stockByWorksite: Record<string, WorksiteStockWithProduct[]>
  initialWorksiteId?: string
}) {
  const sortedWorksites = [...worksites].sort((a, b) => {
    const aHasStock = (stockByWorksite[a.id] ?? []).some((item) => item.quantity > 0)
    const bHasStock = (stockByWorksite[b.id] ?? []).some((item) => item.quantity > 0)
    if (a.id === initialWorksiteId) return -1
    if (b.id === initialWorksiteId) return 1
    if (aHasStock !== bHasStock) return aHasStock ? -1 : 1
    return a.name.localeCompare(b.name, "es")
  })

  return (
    <>
      {sortedWorksites.map((ws) => (
        <StockTable key={ws.id} worksiteName={ws.name}
          items={stockByWorksite[ws.id] ?? []} />
      ))}
    </>
  )
}

function KardexSection({ movements }: { movements: InventoryMovementWithRelations[] }) {
  return <KardexTable movements={movements} />
}
