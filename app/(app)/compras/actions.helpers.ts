/**
 * Shared helpers for purchase order Server Actions.
 */

import { eq } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrders } from "@/db/schema"
import { canAccessWorksite } from "@/lib/auth/can"
import type { ActionState } from "@/lib/validation/operations"
import type { Session } from "next-auth"

export async function assertOrderAccess(
  session: Session,
  orderId: string,
): Promise<ActionState | null> {
  const order = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, orderId),
  })
  if (!order) return { ok: false, message: "Orden no encontrada" }
  if (!canAccessWorksite(session, order.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena de esta orden" }
  }
  return null
}
