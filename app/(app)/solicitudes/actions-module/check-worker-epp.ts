"use server"

import { and, eq, inArray, isNotNull, desc } from "drizzle-orm"
import { db } from "@/db"
import {
  deliveries, deliveryItems,
  purchaseRequestItems, purchaseRequests,
  products, eppProductFamilies, workers,
} from "@/db/schema"
import { canAny, requireAuth } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"

export interface WorkerEppStatusResult {
  activeRequest: { code: string; status: string } | null
  lastDelivery: { deliveredAt: string; lifespanMonths: number | null } | null
}

const EMPTY: WorkerEppStatusResult = { activeRequest: null, lastDelivery: null }

export async function getWorkerEppStatusAction(
  workerId: string,
  productId: string,
): Promise<WorkerEppStatusResult> {
  let session
  try {
    session = await requireAuth()
  } catch {
    return EMPTY
  }
  if (!canAny(session, "requests:create", "requests:view_all", "requests:view_own")) return EMPTY

  if (!workerId || !productId) {
    return EMPTY
  }

  // El workerId llega del cliente: autorizarlo por faena antes de usarlo como
  // clave de consulta, si no cualquier sesión lee el estado EPP de cualquiera.
  const worker = await db.query.workers.findFirst({
    columns: { id: true },
    where: and(eq(workers.id, workerId), worksiteScopeSql(session, workers.worksiteId)),
  })
  if (!worker) return EMPTY

  // 1. Check active requests for this worker + product
  const activeRequestItem = await db
    .select({
      code: purchaseRequests.code,
      status: purchaseRequests.status,
    })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
    .where(and(
      eq(purchaseRequestItems.workerId, workerId),
      eq(purchaseRequestItems.productId, productId),
      inArray(purchaseRequests.status, ["submitted", "in_review", "approved", "partially_approved", "in_purchasing"]),
    ))
    .limit(1)

  const activeRequest = activeRequestItem[0] ? activeRequestItem[0] : null

  // 2. Check last delivery for this worker + product
  const lastDeliveryRow = await db
    .select({
      deliveredAt: deliveries.deliveredAt,
      lifespanMonths: eppProductFamilies.lifespanMonths,
    })
    .from(deliveryItems)
    .innerJoin(deliveries, eq(deliveryItems.deliveryId, deliveries.id))
    .leftJoin(products, eq(deliveryItems.productId, products.id))
    .leftJoin(eppProductFamilies, eq(products.familyId, eppProductFamilies.id))
    .where(and(
      eq(deliveries.destinationType, "worker"),
      eq(deliveries.workerId, workerId),
      eq(deliveryItems.productId, productId),
      isNotNull(deliveries.deliveredAt),
    ))
    .orderBy(desc(deliveries.deliveredAt))
    .limit(1)

  const lastDelivery = lastDeliveryRow[0] ? lastDeliveryRow[0] : null

  return { activeRequest, lastDelivery }
}
