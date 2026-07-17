import type { Metadata } from "next"
import { redirect } from "next/navigation"
import Link from "next/link"
import { db } from "@/db"
import {
  attachments,
  deliveries,
  deliveryItems,
  products,
  purchaseRequestItems,
  purchaseRequests,
  workers,
  worksiteStock,
  worksites,
} from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { ServerPagination } from "@/components/ui/server-pagination"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { Package, User } from "@phosphor-icons/react/dist/ssr"
import { and, asc, desc, eq, inArray, isNotNull, count } from "drizzle-orm"
import { DeliveriesTable, type DeliveryRow } from "./deliveries-table"
import { DeliveryForm, type DeliverableEppOption } from "./delivery-form"
import { DeliveryFormPanel } from "./delivery-form-panel"
import { DeliveryFormTrigger } from "./delivery-form-trigger"

export const metadata: Metadata = { title: "Entregas" }

import { HISTORY_PAGE_SIZE } from "@/lib/constants"

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("deliveries:view") }
  catch { redirect("/forbidden") }

  const sp = await searchParams
  const requestedWorksiteId = typeof sp.faena === "string" ? sp.faena : ""
  const requestedItemId = typeof sp.item === "string" ? sp.item : ""

  const historyScope = and(
    eq(deliveries.destinationType, "worker"),
    worksiteScopeSql(session, deliveries.worksiteId),
  )

  // History pagination
  const [historyTotalRow] = await db
    .select({ total: count() })
    .from(deliveries)
    .where(historyScope)

  const historyPagination = resolvePagination({
    pageParam: sp.page,
    totalItems: historyTotalRow?.total ?? 0,
    pageSize: HISTORY_PAGE_SIZE,
  })

  const pageHref = (page: number) => buildPaginationHref("/entregas", sp, page)

  const [allWorksites, allWorkers, stockRows, receivedItems, historyRows, catalogProducts] = await Promise.all([
    db
      .select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .where(and(eq(worksites.isActive, true), worksiteScopeSql(session, worksites.id)))
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
      .where(and(eq(workers.isActive, true), worksiteScopeSql(session, workers.worksiteId)))
      .orderBy(asc(workers.lastName), asc(workers.firstName)),
    db.query.worksiteStock.findMany({
      with: { product: true },
      where: worksiteScopeSql(session, worksiteStock.worksiteId),
    }),
    db
      .select({
        id:              purchaseRequestItems.id,
        productId:       purchaseRequestItems.productId,
        productNameFree: purchaseRequestItems.productNameFree,
        quantity:        purchaseRequestItems.quantity,
        unitOfMeasure:   purchaseRequestItems.unitOfMeasure,
        requestCode:     purchaseRequests.code,
        requestWorksiteId: purchaseRequests.worksiteId,
        productName:     products.name,
        productSku:      products.sku,
      })
      .from(purchaseRequestItems)
      .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
      .innerJoin(products, eq(purchaseRequestItems.productId, products.id))
      .where(and(
        inArray(purchaseRequestItems.status, ["partially_received", "received", "partially_delivered"]),
        isNotNull(purchaseRequestItems.productId),
        eq(products.isEpp, true),
        worksiteScopeSql(session, purchaseRequests.worksiteId),
      )),
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
      .where(historyScope)
      .orderBy(desc(deliveries.deliveredAt))
      .limit(historyPagination.limit)
      .offset(historyPagination.offset),
    db
      .select({
        id: products.id,
        name: products.name,
        sku: products.sku,
        unitOfMeasure: products.unitOfMeasure,
      })
      .from(products)
      .where(eq(products.isActive, true))
      .orderBy(asc(products.name)),
  ])

  const worksiteOptions = allWorksites.map((worksite) => ({ id: worksite.id, name: worksite.name }))
  const visibleWorksiteIds = new Set(worksiteOptions.map((worksite) => worksite.id))

  const workerOptions = allWorkers
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
    .map((item) => {
      const deliveredQuantity = deliveredByItem.get(item.id) ?? 0
      const remainingQuantity = Math.max(0, item.quantity - deliveredQuantity)
      const stockQuantity = stockByWorksiteProduct.get(`${item.requestWorksiteId}:${item.productId}`) ?? 0
      return {
        requestItemId: item.id,
        requestCode: item.requestCode,
        worksiteId: item.requestWorksiteId,
        productName: item.productName ?? item.productNameFree ?? "EPP recibido",
        productSku: item.productSku,
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

  const visibleHistory = historyRows
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
      receiverName: delivery.receiverName ?? null,
      itemSummary,
      requestCode: firstItem?.requestCode ?? null,
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
        actions={deliverableItems.length > 0 ? <DeliveryFormTrigger /> : undefined}
      />

      <div className="flex flex-col gap-6">
        {/* ── Registrar entrega ── */}
        {deliverableItems.length === 0 ? (
          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-base font-semibold text-(--color-text)">Registrar entrega de EPP</h2>
              <p className="mt-1 text-sm text-(--color-text-muted)">
                Asigna EPP recibido a un trabajador y descuenta el stock de la faena.
              </p>
            </div>
            <div className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
              <EmptyState
                icon={<Package size={24} />}
                title="Sin EPP pendiente de entrega"
                description="Recepciona EPP en el módulo de Recepción para que aparezca aquí disponible para asignar."
                action={
                  <Button asChild variant="secondary">
                    <Link href="/recepcion">Ir a Recepción</Link>
                  </Button>
                }
              />
            </div>
          </section>
        ) : (
          <DeliveryFormPanel>
            <DeliveryForm
              worksites={worksiteOptions}
              workers={workerOptions}
              deliverableItems={deliverableItems}
              returnProducts={catalogProducts}
              initialWorksiteId={initialWorksiteId}
              initialRequestItemId={initialDeliverable?.requestItemId}
            />
          </DeliveryFormPanel>
        )}

        {/* ── Historial de entregas ── */}
        <section id="delivery-history" className="flex flex-col gap-3 scroll-mt-24">
          <div>
            <h2 className="text-base font-semibold text-(--color-text)">Historial de entregas</h2>
            <p className="mt-1 text-sm text-(--color-text-muted)">
              Registro nominal de EPP entregado a trabajadores.
            </p>
          </div>

          {deliveriesForTable.length === 0 ? (
            <div className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
              <EmptyState
                icon={<User size={22} />}
                title="Sin entregas registradas"
                description="Cuando registres una entrega de EPP, quedará disponible en este historial."
                compact
              />
            </div>
          ) : (
            <DeliveriesTable deliveries={deliveriesForTable} />
          )}
          <ServerPagination pagination={historyPagination} hrefForPage={pageHref} />
        </section>
      </div>
    </PageContainer>
  )
}
