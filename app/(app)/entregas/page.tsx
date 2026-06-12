import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import {
  attachments,
  deliveries,
  deliveryItems,
  products,
  purchaseRequestItems,
  purchaseRequests,
  workers,
  worksites,
} from "@/db/schema"
import { requirePermission, canAccessWorksite } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { EmptyState } from "@/components/ui/empty-state"
import { Package, User } from "@phosphor-icons/react/dist/ssr"
import { and, asc, desc, eq, inArray } from "drizzle-orm"
import { DeliveriesTable, type DeliveryRow } from "./deliveries-table"
import { DeliveryForm, type DeliverableEppOption } from "./delivery-form"

export const metadata: Metadata = { title: "Entregas" }

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("warehouse:register_movement") }
  catch { redirect("/dashboard") }

  const sp = await searchParams
  const requestedWorksiteId = typeof sp.faena === "string" ? sp.faena : ""
  const requestedItemId = typeof sp.item === "string" ? sp.item : ""

  const [allWorksites, allWorkers, stockRows, receivedItems, historyRows] = await Promise.all([
    db
      .select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .where(eq(worksites.isActive, true))
      .orderBy(asc(worksites.name)),
    db
      .select({
        id: workers.id,
        rut: workers.rut,
        firstName: workers.firstName,
        lastName: workers.lastName,
        position: workers.position,
        worksiteId: workers.worksiteId,
      })
      .from(workers)
      .where(eq(workers.isActive, true))
      .orderBy(asc(workers.lastName), asc(workers.firstName)),
    db.query.worksiteStock.findMany({
      with: { product: true },
    }),
    db.query.purchaseRequestItems.findMany({
      where: inArray(purchaseRequestItems.status, ["received", "partially_delivered"]),
      with: { product: true, request: true },
    }),
    db
      .select({
        id: deliveries.id,
        code: deliveries.code,
        worksiteId: deliveries.worksiteId,
        workerId: deliveries.workerId,
        receiverName: deliveries.receiverName,
        deliveredAt: deliveries.deliveredAt,
      })
      .from(deliveries)
      .where(eq(deliveries.destinationType, "worker"))
      .orderBy(desc(deliveries.deliveredAt)),
  ])

  const worksiteOptions = allWorksites
    .filter((worksite) => canAccessWorksite(session, worksite.id))
    .map((worksite) => ({ id: worksite.id, name: worksite.name }))
  const visibleWorksiteIds = new Set(worksiteOptions.map((worksite) => worksite.id))

  const workerOptions = allWorkers
    .filter((worker) => visibleWorksiteIds.has(worker.worksiteId))
    .map((worker) => ({
      id: worker.id,
      worksiteId: worker.worksiteId,
      name: `${worker.firstName} ${worker.lastName}`,
      rut: worker.rut,
      position: worker.position,
    }))

  const stockByWorksiteProduct = new Map<string, number>()
  for (const row of stockRows) {
    stockByWorksiteProduct.set(`${row.worksiteId}:${row.productId}`, row.quantity)
  }

  const receivedItemIds = receivedItems.map((item) => item.id)
  const deliveredRows = receivedItemIds.length > 0
    ? await db
        .select({ requestItemId: deliveryItems.requestItemId, quantity: deliveryItems.quantity })
        .from(deliveryItems)
        .where(inArray(deliveryItems.requestItemId, receivedItemIds))
    : []

  const deliveredByItem = new Map<string, number>()
  for (const row of deliveredRows) {
    if (!row.requestItemId) continue
    deliveredByItem.set(row.requestItemId, (deliveredByItem.get(row.requestItemId) ?? 0) + row.quantity)
  }

  const deliverableItems: DeliverableEppOption[] = receivedItems
    .filter((item) =>
      item.productId !== null &&
      item.product?.isEpp &&
      visibleWorksiteIds.has(item.request.worksiteId)
    )
    .map((item) => {
      const deliveredQuantity = deliveredByItem.get(item.id) ?? 0
      const remainingQuantity = Math.max(0, item.quantity - deliveredQuantity)
      const stockQuantity = stockByWorksiteProduct.get(`${item.request.worksiteId}:${item.productId}`) ?? 0
      return {
        requestItemId: item.id,
        requestCode: item.request.code,
        worksiteId: item.request.worksiteId,
        productName: item.product?.name ?? item.productNameFree ?? "EPP recibido",
        productSku: item.product?.sku ?? null,
        quantity: item.quantity,
        deliveredQuantity,
        remainingQuantity,
        stockQuantity,
        unitOfMeasure: item.unitOfMeasure,
      }
    })
    .filter((item) => item.remainingQuantity > 0 && item.stockQuantity > 0)

  const initialDeliverable = requestedItemId
    ? deliverableItems.find((item) => item.requestItemId === requestedItemId)
    : undefined
  const initialWorksiteId = initialDeliverable?.worksiteId
    ?? (requestedWorksiteId && visibleWorksiteIds.has(requestedWorksiteId) ? requestedWorksiteId : undefined)
    ?? deliverableItems[0]?.worksiteId
    ?? worksiteOptions[0]?.id

  const visibleHistory = historyRows.filter((delivery) =>
    delivery.worksiteId ? visibleWorksiteIds.has(delivery.worksiteId) : false
  )
  const historyDeliveryIds = visibleHistory.map((delivery) => delivery.id)
  const [historyItemRows, attachmentRows] = await Promise.all([
    historyDeliveryIds.length > 0
      ? db
          .select({
            deliveryId: deliveryItems.deliveryId,
            requestItemId: deliveryItems.requestItemId,
            productNameFree: deliveryItems.productNameFree,
            quantity: deliveryItems.quantity,
            unitOfMeasure: deliveryItems.unitOfMeasure,
            productName: products.name,
            requestCode: purchaseRequests.code,
          })
          .from(deliveryItems)
          .leftJoin(products, eq(deliveryItems.productId, products.id))
          .leftJoin(purchaseRequestItems, eq(deliveryItems.requestItemId, purchaseRequestItems.id))
          .leftJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
          .where(inArray(deliveryItems.deliveryId, historyDeliveryIds))
      : Promise.resolve([]),
    historyDeliveryIds.length > 0
      ? db
          .select({ id: attachments.id, entityId: attachments.entityId })
          .from(attachments)
          .where(
            and(
              eq(attachments.entityType, "delivery"),
              inArray(attachments.entityId, historyDeliveryIds),
            ),
          )
      : Promise.resolve([]),
  ])

  const historyItemsByDelivery = new Map<string, typeof historyItemRows>()
  for (const item of historyItemRows) {
    const list = historyItemsByDelivery.get(item.deliveryId) ?? []
    list.push(item)
    historyItemsByDelivery.set(item.deliveryId, list)
  }
  const attachmentByDeliveryId = new Map(attachmentRows.map((row) => [row.entityId, row.id]))
  const worksiteNameById = new Map(worksiteOptions.map((worksite) => [worksite.id, worksite.name]))
  const workerNameById = new Map(workerOptions.map((worker) => [worker.id, worker.name]))

  const deliveriesForTable: DeliveryRow[] = visibleHistory.map((delivery) => {
    const items = historyItemsByDelivery.get(delivery.id) ?? []
    const firstItem = items[0]
    const itemSummary = firstItem
      ? `${firstItem.productName ?? firstItem.productNameFree ?? "EPP"} · ${firstItem.quantity} ${firstItem.unitOfMeasure}`
      : "Sin ítems"
    return {
      id: delivery.id,
      code: delivery.code,
      worksiteName: delivery.worksiteId ? (worksiteNameById.get(delivery.worksiteId) ?? "Faena") : "Faena",
      workerName: delivery.workerId ? (workerNameById.get(delivery.workerId) ?? "Trabajador") : "Trabajador",
      itemSummary,
      requestCode: firstItem?.requestCode ?? null,
      receiverName: delivery.receiverName,
      deliveredAt: delivery.deliveredAt,
      attachmentId: attachmentByDeliveryId.get(delivery.id) ?? null,
    }
  })

  if (worksiteOptions.length === 0) {
    return (
      <PageContainer>
        <PageHeader
          title="Entregas"
          description="Asignación de EPP recibido a trabajadores."
          breadcrumb={<Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Entregas" }]} />}
        />
        <EmptyState
          icon={<User size={24} />}
          title="Sin faenas asignadas"
          description="No tienes faenas activas disponibles para registrar entregas."
        />
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Entregas"
        description="Asignación de EPP recibido a trabajadores."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Entregas" },
          ]} />
        }
      />

      <div className="flex flex-col gap-6">
        {deliverableItems.length === 0 ? (
          <EmptyState
            icon={<Package size={24} />}
            title="Sin EPP pendiente de entrega"
            description="Los EPP recibidos con stock disponible aparecerán aquí para asignarlos a trabajadores."
          />
        ) : (
          <DeliveryForm
            worksites={worksiteOptions}
            workers={workerOptions}
            deliverableItems={deliverableItems}
            initialWorksiteId={initialWorksiteId}
            initialRequestItemId={initialDeliverable?.requestItemId}
          />
        )}

        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text)]">Historial de entregas</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Registro nominal de EPP entregado a trabajadores.
            </p>
          </div>

          {deliveriesForTable.length === 0 ? (
            <EmptyState
              icon={<User size={22} />}
              title="Sin entregas registradas"
              description="Cuando registres una entrega de EPP, quedará disponible en este historial."
            />
          ) : (
            <DeliveriesTable deliveries={deliveriesForTable} />
          )}
        </section>
      </div>
    </PageContainer>
  )
}
