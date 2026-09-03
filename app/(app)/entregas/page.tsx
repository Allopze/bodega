import type { Metadata } from "next"
import { redirect } from "next/navigation"
import Link from "next/link"
import { db } from "@/db"
import {
  attachments,
  deliveries,
  deliveryItems,
  eppProductFamilies,
  products,
  purchaseOrderItems,
  purchaseRequestItems,
  purchaseRequests,
  workers,
  worksiteStock,
  worksites,
} from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { formatQty, todayInChile } from "@/lib/utils"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { ServerPagination } from "@/components/ui/server-pagination"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { DownloadSimple, Package, User } from "@phosphor-icons/react/dist/ssr"
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { DeliveriesTable, type DeliveryRow } from "./deliveries-table"
import type { DeliverableEppOption, DeliveryStockProductOption } from "./delivery-form.types"
import { DeliveryFormSheet } from "./delivery-form-sheet"
import { getProductSizesByIds } from "@/lib/services/product-sizes"
import { getTraceableDeliveryBalance } from "@/lib/services/delivery-eligibility"

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
  const canViewTraceability = session.user.permissions.includes("warehouse:view_traceability")
  const canCreateDelivery = session.user.permissions.includes("deliveries:create")
  const canVoidDelivery = session.user.permissions.includes("deliveries:void")

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

  const [allWorksites, allWorkers, stockRows, receivedItems, historyRows] = await Promise.all([
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
        sizeTop: workers.sizeTop,
        sizeBottom: workers.sizeBottom,
        sizeShoe: workers.sizeShoe,
        sizeGloves: workers.sizeGloves,
        sizeHelmet: workers.sizeHelmet,
      })
      .from(workers)
      .where(and(eq(workers.isActive, true), worksiteScopeSql(session, workers.worksiteId)))
      .orderBy(asc(workers.lastName), asc(workers.firstName)),
    // Fuente de verdad de entregas: saldo físico de productos de catálogo. Los
    // servicios no producen ni consumen stock.
    db
      .select({
        worksiteId: worksiteStock.worksiteId,
        productId:  worksiteStock.productId,
        quantity:   worksiteStock.quantity,
        productName: products.name,
        productSku: products.sku,
        isEpp: products.isEpp,
        unitOfMeasure: products.unitOfMeasure,
        familyId: products.familyId,
        familyName: eppProductFamilies.canonicalName,
      })
      .from(worksiteStock)
      .innerJoin(products, eq(worksiteStock.productId, products.id))
      .leftJoin(eppProductFamilies, eq(products.familyId, eppProductFamilies.id))
      .where(and(
        worksiteScopeSql(session, worksiteStock.worksiteId),
        gt(worksiteStock.quantity, 0),
        eq(products.isActive, true),
        eq(products.isService, false),
      )),
    db
      .select({
        id:              purchaseRequestItems.id,
        productId:       purchaseRequestItems.productId,
        productNameFree: purchaseRequestItems.productNameFree,
        quantity:        purchaseRequestItems.quantity,
        unitOfMeasure:   purchaseRequestItems.unitOfMeasure,
        urgency:         purchaseRequestItems.urgency,
        requiredDate:    purchaseRequestItems.requiredDate,
        status:          purchaseRequestItems.status,
        createdAt:       purchaseRequestItems.createdAt,
        requestCode:     purchaseRequests.code,
        requestWorksiteId: purchaseRequests.worksiteId,
        productName:     products.name,
        productSku:      products.sku,
      })
      .from(purchaseRequestItems)
      .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
      .innerJoin(products, eq(purchaseRequestItems.productId, products.id))
      .where(and(
        inArray(purchaseRequestItems.status, ["partially_received", "partially_delivered"]),
        isNotNull(purchaseRequestItems.productId),
        eq(products.isEpp, true),
        worksiteScopeSql(session, purchaseRequests.worksiteId),
      )),
    db
      .select({
        id: deliveries.id,
        code: deliveries.code,
        sourceWorksiteId: deliveries.sourceWorksiteId,
        worksiteId: deliveries.worksiteId,
        workerId: deliveries.workerId,
        receiverName: deliveries.receiverName,
        deliveredAt: deliveries.deliveredAt,
        voidedAt: deliveries.voidedAt,
        voidReason: deliveries.voidReason,
      })
      .from(deliveries)
      .where(historyScope)
      .orderBy(desc(deliveries.deliveredAt))
      .limit(historyPagination.limit)
      .offset(historyPagination.offset),
  ])

  const worksiteOptions = allWorksites.map((worksite) => ({ id: worksite.id, name: worksite.name }))
  const visibleWorksiteIds = new Set(worksiteOptions.map((worksite) => worksite.id))
  const worksiteNameById = new Map(worksiteOptions.map((worksite) => [worksite.id, worksite.name]))

  const workerOptions = allWorkers
    .map((worker) => ({
      id: worker.id,
      worksiteId: worker.worksiteId,
      worksiteName: worksiteNameById.get(worker.worksiteId) ?? "Faena",
      name: `${worker.firstName} ${worker.lastName}`,
      rut: worker.rut,
      position: worker.position,
      sizeTop: worker.sizeTop,
      sizeBottom: worker.sizeBottom,
      sizeShoe: worker.sizeShoe,
      sizeGloves: worker.sizeGloves,
      sizeHelmet: worker.sizeHelmet,
    }))

  const stockByWorksiteProduct = new Map<string, number>()
  for (const row of stockRows) {
    stockByWorksiteProduct.set(`${row.worksiteId}:${row.productId}`, row.quantity)
  }

  // La talla vive en `product_attributes` de la variante: una sola consulta por
  // el conjunto de productos con stock, no una por fila.
  const sizeById = await getProductSizesByIds(stockRows.map((row) => row.productId))

  const stockProducts: DeliveryStockProductOption[] = stockRows.map((row) => {
    const size = sizeById.get(row.productId)
    return {
      sourceWorksiteId: row.worksiteId,
      productId: row.productId,
      productName: row.productName,
      productSku: row.productSku,
      isEpp: row.isEpp,
      unitOfMeasure: row.unitOfMeasure,
      stockQuantity: row.quantity,
      familyId: row.familyId,
      familyName: row.familyName,
      sizeLabel: size?.label ?? null,
      sizeAttributeName: size?.attributeName ?? null,
    }
  })

  const receivedItemIds = receivedItems.map((item) => item.id)
  const [deliveredRows, faenaReceiptRows] = receivedItemIds.length > 0
    ? await Promise.all([
        db
          .select({ requestItemId: deliveryItems.requestItemId, quantity: deliveryItems.quantity })
          .from(deliveryItems)
          // Una entrega anulada no consumió saldo: el ítem vuelve a estar
          // disponible para entregar.
          .innerJoin(deliveries, eq(deliveryItems.deliveryId, deliveries.id))
          .where(and(
            inArray(deliveryItems.requestItemId, receivedItemIds),
            isNull(deliveries.voidedAt),
          )),
        db
          .select({
            requestItemId: purchaseOrderItems.requestItemId,
            receivedAtFaena: sql<number>`coalesce(sum(${purchaseOrderItems.quantityReceived}), 0)`,
          })
          .from(purchaseOrderItems)
          .where(inArray(purchaseOrderItems.requestItemId, receivedItemIds))
          .groupBy(purchaseOrderItems.requestItemId),
      ])
    : [[], []]

  const deliveredByItem = new Map<string, number>()
  for (const row of deliveredRows) {
    if (!row.requestItemId) continue
    deliveredByItem.set(row.requestItemId, (deliveredByItem.get(row.requestItemId) ?? 0) + row.quantity)
  }

  const receivedAtFaenaByItem = new Map<string, number>()
  for (const row of faenaReceiptRows) {
    if (!row.requestItemId) continue
    receivedAtFaenaByItem.set(row.requestItemId, Number(row.receivedAtFaena ?? 0))
  }

  const deliverableItems: DeliverableEppOption[] = receivedItems
    .map((item) => {
      const deliveredQuantity = deliveredByItem.get(item.id) ?? 0
      const receivedAtFaena = receivedAtFaenaByItem.get(item.id) ?? 0
      const remainingQuantity = getTraceableDeliveryBalance({
        requestedQuantity: item.quantity,
        receivedAtFaena,
        deliveredQuantity,
      })
      const stockQuantity = stockByWorksiteProduct.get(`${item.requestWorksiteId}:${item.productId}`) ?? 0
      return {
        requestItemId: item.id,
        requestCode: item.requestCode,
        worksiteId: item.requestWorksiteId,
        productId: item.productId!,
        productName: item.productName ?? item.productNameFree ?? "EPP recibido",
        productSku: item.productSku,
        quantity: item.quantity,
        deliveredQuantity,
        receivedAtFaena,
        remainingQuantity,
        stockQuantity,
        unitOfMeasure: item.unitOfMeasure,
      }
    })
    .filter((item) => item.remainingQuantity > 0 && item.stockQuantity > 0)

  const initialDeliverable = requestedItemId
    ? deliverableItems.find((item) => item.requestItemId === requestedItemId)
    : undefined
  // Sólo la intención explícita del operador (item de solicitud o ?faena=).
  // El fallback lo decide el formulario, que es quien conoce la dotación: caer
  // en `stockProducts[0]` elegía una bodega arbitraria (la consulta de stock no
  // lleva ORDER BY) y en la práctica abría en la bodega de oficina, que tiene
  // stock pero no trabajadores de faena.
  const initialWorksiteId = initialDeliverable?.worksiteId
    ?? (requestedWorksiteId && visibleWorksiteIds.has(requestedWorksiteId) ? requestedWorksiteId : undefined)
  const worksiteScopeLabel = requestedWorksiteId && visibleWorksiteIds.has(requestedWorksiteId)
    ? worksiteNameById.get(requestedWorksiteId) ?? "faena seleccionada"
    : "todas las faenas permitidas"

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
            quantityOriginal: deliveryItems.quantityOriginal,
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
  const workerNameById = new Map(workerOptions.map((worker) => [worker.id, worker.name]))

  const deliveriesForTable: DeliveryRow[] = visibleHistory.map((delivery) => {
    const items = historyItemsByDelivery.get(delivery.id) ?? []
    const firstItem = items[0]
    const itemSummary = firstItem
      ? `${firstItem.productName ?? firstItem.productNameFree ?? "EPP"} · ${formatQty(firstItem.quantity, firstItem.unitOfMeasure)}`
      : "Sin ítems"
    return {
      id: delivery.id,
      code: delivery.code,
      sourceWorksiteName: delivery.sourceWorksiteId
        ? (worksiteNameById.get(delivery.sourceWorksiteId) ?? "Bodega")
        : (delivery.worksiteId ? (worksiteNameById.get(delivery.worksiteId) ?? "Faena") : "Sin registro"),
      worksiteName: delivery.worksiteId ? (worksiteNameById.get(delivery.worksiteId) ?? "Faena") : "Faena",
      workerId: delivery.workerId ?? null,
      workerName: delivery.workerId ? (workerNameById.get(delivery.workerId) ?? "Trabajador") : "Trabajador",
      receiverName: delivery.receiverName ?? null,
      itemSummary,
      quantityCorrected: items.some((item) => item.quantityOriginal !== null),
      requestCode: firstItem?.requestCode ?? null,
      deliveredAt: delivery.deliveredAt,
      voidedAt: delivery.voidedAt ?? null,
      voidReason: delivery.voidReason ?? null,
      attachmentId: attachmentByDeliveryId.get(delivery.id) ?? null,
    }
  })

  if (worksiteOptions.length === 0) {
    return (
      <PageContainer>
        <PageHeader
          title="Entregas"
          description="Entrega de productos físicos desde bodega a trabajadores."
          breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Entregas" }]} />}
        />
        <EmptyState
          icon={<User size={24} />}
          title="Sin faenas asignadas"
          // El CTA anterior enlazaba a /admin/usuarios: quien no tiene faenas
          // casi por definición tampoco es administrador, así que el botón
          // rebotaba en /forbidden. Sin acción posible, el texto dice a quién
          // acudir en vez de ofrecer una puerta cerrada.
          description="No tienes faenas activas disponibles para registrar entregas. Pide a un administrador que te asigne una faena."
        />
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Entregas"
        description="Entrega de productos físicos desde bodega a trabajadores."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Entregas" },
          ]} />
        }
        actions={
          <div className="flex items-center gap-2">
            {canCreateDelivery && (
              <DeliveryFormSheet
                worksites={worksiteOptions}
                workers={workerOptions}
                stockProducts={stockProducts}
                today={todayInChile()}
                initialSourceWorksiteId={initialWorksiteId}
                initialProductId={initialDeliverable?.productId}
              />
            )}
            <Button asChild variant="secondary" size="sm">
              <a href="/api/entregas/export" download>
                <DownloadSimple size={15} aria-hidden />
                Exportar Excel
              </a>
            </Button>
          </div>
        }
      />
      <p className="mb-3 text-xs text-(--color-text-subtle)" aria-live="polite">
        Alcance de faena: <span className="font-medium text-(--color-text-muted)">{worksiteScopeLabel}</span>
      </p>

      <div className="flex flex-col gap-6">
        {/* La captura depende de stock físico, no de una solicitud EPP
            pendiente: así el selector de trabajadores no desaparece por una
            condición ajena al padrón de trabajadores. */}
        {stockProducts.length === 0 ? (
          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-base font-semibold text-(--color-text)">Sin stock físico para entregar</h2>
              <p className="mt-1 text-sm text-(--color-text-muted)">
                No hay productos físicos con saldo en las bodegas a las que tienes acceso.
              </p>
            </div>
            <div className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
              <EmptyState
                icon={<Package size={24} />}
                title="Aún no hay stock disponible"
                description="Registra la recepción física de una OC o confirma la guía a faena. Los servicios no se incorporan al stock."
                action={
                  <Button asChild variant="secondary">
                    <Link href="/recepcion">Ir a Recepción</Link>
                  </Button>
                }
              />
            </div>
          </section>
        ) : (
          <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <h2 className="text-base font-semibold text-[var(--color-text)]">Entrega desde stock real</h2>
            <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
              Selecciona “Registrar entrega” para entregar uno o más productos. El trabajador se busca en el padrón activo y su faena se muestra junto a su nombre.
            </p>
          </section>
        )}

        {/* ── Historial de entregas ── */}
        <section id="delivery-history" className="flex flex-col gap-3 scroll-mt-24">
          <div>
            <h2 className="text-base font-semibold text-(--color-text)">Historial de entregas</h2>
            <p className="mt-1 text-sm text-(--color-text-muted)">
              Registro nominal de productos físicos entregados a trabajadores.
            </p>
          </div>

          {deliveriesForTable.length === 0 ? (
            <div className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
              <EmptyState
                icon={<User size={22} />}
                title="Sin entregas registradas"
                description="Cuando registres una entrega, quedará disponible en este historial."
                compact
              />
            </div>
          ) : (
            <DeliveriesTable deliveries={deliveriesForTable} canViewTraceability={canViewTraceability} canVoid={canVoidDelivery} />
          )}
          <ServerPagination pagination={historyPagination} hrefForPage={pageHref} />
        </section>
      </div>
    </PageContainer>
  )
}
