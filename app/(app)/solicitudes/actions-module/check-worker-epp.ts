"use server"

import { and, eq, inArray, isNotNull, desc } from "drizzle-orm"
import { db } from "@/db"
import {
  deliveries, deliveryItems,
  purchaseRequestItems, purchaseRequests,
  products, eppProductFamilies,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth/can"

export interface WorkerEppStatusResult {
  activeRequest: { code: string; status: string } | null
  lastDelivery: { deliveredAt: string; lifespanMonths: number | null } | null
}

export async function getWorkerEppStatusAction(
  workerId: string,
  productId: string,
): Promise<WorkerEppStatusResult> {
  try {
    await requireAuth()
  } catch {
    return { activeRequest: null, lastDelivery: null }
  }

  if (!workerId || !productId) {
    return { activeRequest: null, lastDelivery: null }
  }

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
