import { db } from "@/db"
import {
  purchaseRequests,
  purchaseRequestItems,
  purchaseOrders,
  purchaseOrderItems,
  receipts,
  receiptItems,
  dispatchGuides,
  dispatchGuideItems,
  deliveries,
  deliveryItems,
  worksiteStock,
  products,
  productCategories,
  worksites,
  users,
  suppliers,
  workers,
  approvalDecisions,
} from "@/db/schema"
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import type { Session } from "next-auth"

/**
 * Techo de ítems que la vista consolidada carga en memoria.
 *
 * El filtrado secundario, los KPIs y la paginación se hacen sobre el conjunto
 * completo de la faena, así que sin tope una faena con años de historia
 * arrastraba todo a RAM en cada carga. Cuando se alcanza, la vista lo dice en
 * pantalla en vez de mentir con totales cortados en silencio.
 */
export const TRACEABILITY_MAX_ITEM_ROWS = 2_000

/**
 * Catálogos que no dependen de la faena elegida (faenas visibles, categorías y
 * proveedores). Se separó de `fetchTraceabilityRequesters` porque el servicio
 * necesitaba los solicitantes recién después de resolver la faena y terminaba
 * llamando dos veces a la misma función: las tres consultas de catálogo se
 * ejecutaban duplicadas en cada carga de la página.
 */
export async function fetchTraceabilityAuxiliaryData(session: Session) {
  const allWorksites = await db
    .select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(and(eq(worksites.isActive, true), worksiteScopeSql(session, worksites.id)))
    .orderBy(asc(worksites.name))

  const [categoriesList, suppliersList] = await Promise.all([
    db
      .select({ id: productCategories.id, name: productCategories.name })
      .from(productCategories)
      .orderBy(asc(productCategories.name)),
    db
      .select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers)
      .where(eq(suppliers.isActive, true))
      .orderBy(asc(suppliers.name)),
  ])

  return { allWorksites, categoriesList, suppliersList }
}

/** Solicitantes que efectivamente pidieron algo en la faena activa. */
export async function fetchTraceabilityRequesters(filterFaenaId: string) {
  if (!filterFaenaId) return []
  return db
    .selectDistinct({ id: users.id, name: users.name })
    .from(purchaseRequests)
    .innerJoin(users, eq(purchaseRequests.requesterId, users.id))
    .where(eq(purchaseRequests.worksiteId, filterFaenaId))
    .orderBy(asc(users.name))
}

export interface TraceabilityItemFilters {
  filterFaenaId: string
  filterSolicitante: string
  filterDesde: string
  filterHasta: string
}

export async function fetchRawItemRows(session: Session, filters: TraceabilityItemFilters) {
  const isGlobal = isGlobalRole(session)
  const scopedWorksiteIds = visibleWorksiteIds(session)
  const { filterFaenaId, filterSolicitante, filterDesde, filterHasta } = filters

  const requestConditions = [
    eq(purchaseRequests.worksiteId, filterFaenaId),
    !isGlobal ? inArray(purchaseRequests.worksiteId, scopedWorksiteIds) : undefined,
    filterSolicitante ? eq(purchaseRequests.requesterId, filterSolicitante) : undefined,
    filterDesde ? sql`${purchaseRequests.createdAt} >= ${filterDesde}` : undefined,
    filterHasta ? sql`${purchaseRequests.createdAt} <= ${filterHasta + "T23:59:59"}` : undefined,
  ].filter(Boolean)

  return db
    .select({
      itemId: purchaseRequestItems.id,
      requestId: purchaseRequests.id,
      requestCode: purchaseRequests.code,
      requestStatus: purchaseRequests.status,
      requestDate: purchaseRequests.createdAt,
      requesterId: purchaseRequests.requesterId,
      requesterName: users.name,
      deliveryMode: purchaseRequests.deliveryMode,
      requestUrgency: purchaseRequests.urgency,
      urgency: purchaseRequestItems.urgency,

      productId: purchaseRequestItems.productId,
      productNameCatalog: products.name,
      productNameFree: purchaseRequestItems.productNameFree,
      productSku: products.sku,
      categoryId: products.categoryId,
      categoryName: productCategories.name,
      notes: purchaseRequestItems.notes,
      uom: purchaseRequestItems.unitOfMeasure,
      quantity: purchaseRequestItems.quantity,
      status: purchaseRequestItems.status,
      updatedAt: purchaseRequestItems.updatedAt,
    })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
    .innerJoin(users, eq(purchaseRequests.requesterId, users.id))
    .leftJoin(products, eq(purchaseRequestItems.productId, products.id))
    .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
    .where(and(...requestConditions))
    .orderBy(desc(purchaseRequestItems.createdAt))
    .limit(TRACEABILITY_MAX_ITEM_ROWS)
}

export async function fetchLinkedTraceabilityData(
  allItemIds: string[],
  allProductIds: string[],
  filterFaenaId: string,
) {
  const [approvalRows, ocRows, deliveryRows, stockRows] = await Promise.all([
    db
      .select({
        id: approvalDecisions.id,
        requestItemId: approvalDecisions.requestItemId,
        type: approvalDecisions.type,
        decidedAt: approvalDecisions.decidedAt,
        decidedByName: users.name,
        reason: approvalDecisions.reason,
        modifiedQty: approvalDecisions.modifiedQty,
      })
      .from(approvalDecisions)
      .innerJoin(users, eq(approvalDecisions.decidedBy, users.id))
      .where(
        and(
          inArray(approvalDecisions.requestItemId, allItemIds),
          inArray(approvalDecisions.type, ["approve", "modify"]),
        ),
      )
      // La cantidad aprobada la fija la última decisión, así que el orden es
      // parte del resultado: sin `ORDER BY`, un ítem con `modify` + `approve`
      // tomaba la que Postgres devolviera primero y la cantidad aprobada
      // cambiaba entre cargas de la misma página.
      .orderBy(asc(approvalDecisions.decidedAt), asc(approvalDecisions.id)),

    db
      .select({
        id: purchaseOrderItems.id,
        requestItemId: purchaseOrderItems.requestItemId,
        purchaseOrderId: purchaseOrderItems.purchaseOrderId,
        orderCode: purchaseOrders.code,
        orderStatus: purchaseOrders.status,
        issuedAt: purchaseOrders.issuedAt,
        sentAt: purchaseOrders.sentAt,
        createdAt: purchaseOrders.createdAt,
        supplierId: purchaseOrders.supplierId,
        supplierName: suppliers.name,
        quantity: purchaseOrderItems.quantity,
        quantityOfficeReceived: purchaseOrderItems.quantityOfficeReceived,
        quantityReceived: purchaseOrderItems.quantityReceived,
      })
      .from(purchaseOrderItems)
      .innerJoin(purchaseOrders, eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id))
      .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .where(
        and(
          inArray(purchaseOrderItems.requestItemId, allItemIds),
          sql`${purchaseOrderItems.status} <> 'cancelled'`,
          sql`${purchaseOrders.status} <> 'cancelled'`,
        ),
      ),

    db
      .select({
        id: deliveryItems.id,
        requestItemId: deliveryItems.requestItemId,
        deliveryId: deliveries.id,
        deliveryCode: deliveries.code,
        deliveredAt: deliveries.deliveredAt,
        deliveredByName: users.name,
        receiverName: deliveries.receiverName,
        workerFirstName: workers.firstName,
        workerLastName: workers.lastName,
        quantity: deliveryItems.quantity,
        returnQuantity: deliveryItems.returnQuantity,
        // Una entrega anulada sigue existiendo como documento pero no entregó
        // nada. Viaja con su marca en vez de filtrarse en el SQL: los totales
        // la descartan (ver `buildConsolidatedRows`) y el historial la sigue
        // mostrando anulada, que es justo lo que una auditoría necesita ver.
        voidedAt: deliveries.voidedAt,
        voidReason: deliveries.voidReason,
      })
      .from(deliveryItems)
      .innerJoin(deliveries, eq(deliveryItems.deliveryId, deliveries.id))
      .innerJoin(users, eq(deliveries.deliveredBy, users.id))
      .leftJoin(workers, eq(deliveries.workerId, workers.id))
      .where(inArray(deliveryItems.requestItemId, allItemIds)),

    allProductIds.length > 0
      ? db
          .select({
            productId: worksiteStock.productId,
            quantity: worksiteStock.quantity,
          })
          .from(worksiteStock)
          .where(
            and(
              eq(worksiteStock.worksiteId, filterFaenaId),
              inArray(worksiteStock.productId, allProductIds),
            ),
          )
      : Promise.resolve([]),
  ])

  const ocItemIds = ocRows.map((o) => o.id)

  const [receiptRows, gdiRows] = ocItemIds.length > 0
    ? await Promise.all([
        db
          .select({
            id: receiptItems.id,
            purchaseOrderItemId: receiptItems.purchaseOrderItemId,
            receiptId: receipts.id,
            receiptCode: receipts.code,
            locationType: receipts.locationType,
            receivedAt: receipts.receivedAt,
            receivedByName: users.name,
            quantityReceived: receiptItems.quantityReceived,
            quantityRejected: receiptItems.quantityRejected,
          })
          .from(receiptItems)
          .innerJoin(receipts, eq(receiptItems.receiptId, receipts.id))
          .innerJoin(users, eq(receipts.receivedBy, users.id))
          .where(inArray(receiptItems.purchaseOrderItemId, ocItemIds)),

        db
          .select({
            id: dispatchGuideItems.id,
            purchaseOrderItemId: dispatchGuideItems.purchaseOrderItemId,
            guideId: dispatchGuides.id,
            guideCode: dispatchGuides.code,
            guideStatus: dispatchGuides.status,
            dispatchedAt: dispatchGuides.dispatchedAt,
            receivedAt: dispatchGuides.receivedAt,
            dispatchedByName: users.name,
            quantity: dispatchGuideItems.quantity,
            quantityReceived: dispatchGuideItems.quantityReceived,
          })
          .from(dispatchGuideItems)
          .innerJoin(dispatchGuides, eq(dispatchGuideItems.guideId, dispatchGuides.id))
          .leftJoin(users, eq(dispatchGuides.dispatchedBy, users.id))
          .where(
            and(
              inArray(dispatchGuideItems.purchaseOrderItemId, ocItemIds),
              eq(dispatchGuides.destinationWorksiteId, filterFaenaId),
              inArray(dispatchGuides.status, ["dispatched", "partially_received", "received"]),
            ),
          ),
      ])
    : [[], []]

  return {
    approvalRows,
    ocRows,
    deliveryRows,
    stockRows,
    receiptRows,
    gdiRows,
  }
}
