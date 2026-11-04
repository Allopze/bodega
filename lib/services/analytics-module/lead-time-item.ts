import type { Session } from "next-auth"
import { and, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { purchaseRequestItems, purchaseRequests } from "@/db/schema"
import { can } from "@/lib/auth/can"
import { worksiteFilter } from "./helpers"
import type { ItemMilestones } from "./lead-time-item-stages"
import { leadTimeMilestoneSql } from "./lead-time-sql"

/**
 * Los hitos de **un** ítem para su ficha de Seguimiento (CHART-029, vista por ítem): cuántos días llevó
 * cada tramo del ciclo solicitud → aprobación → OC → llegada → entrega.
 *
 * Usa los mismos fragmentos SQL que `getSupplyLeadTime` (`lead-time-sql.ts`), así que el ítem que
 * Analítica cuenta como lento se ve en su ficha con exactamente los mismos plazos. Lo que se hace con
 * ellos (qué tramo está en curso, cuál se saltó) vive en `lead-time-item-stages.ts`.
 *
 * **Alcance.** Exige el permiso de la pantalla que lo muestra (`warehouse:view_traceability`) y aplica el
 * alcance de faenas del usuario sobre la faena de la **solicitud**; un ítem de una faena ajena es
 * indistinguible de uno inexistente (`null`), igual que `getItemDetail`.
 */

export interface ItemLeadTime {
  itemId: string
  /** Estado actual del ítem: decide si sigue abierto, se cerró o se detuvo. */
  status: string
  milestones: ItemMilestones
}

const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value))

export async function getItemLeadTime(session: Session, itemId: string): Promise<ItemLeadTime | null> {
  if (!can(session, "warehouse:view_traceability")) throw new Error("No autorizado")

  const milestones = leadTimeMilestoneSql()
  const [row] = await db.select({
    status: purchaseRequestItems.status,
    submittedDay: sql<number | null>`${milestones.submittedDay}`,
    approvedDay: sql<number | null>`${milestones.approvedDay}`,
    issuedDay: sql<number | null>`${milestones.issuedDay}`,
    arrivedDay: sql<number | null>`${milestones.arrivedDay}`,
    deliveredDay: sql<number | null>`${milestones.deliveredDay}`,
    closedDay: sql<number | null>`${milestones.closedDay}`,
  })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
    .where(and(eq(purchaseRequestItems.id, itemId), worksiteFilter(session, purchaseRequests.worksiteId)))
    .limit(1)
  if (!row) return null

  return {
    itemId,
    status: row.status,
    milestones: {
      submittedDay: num(row.submittedDay),
      approvedDay: num(row.approvedDay),
      issuedDay: num(row.issuedDay),
      arrivedDay: num(row.arrivedDay),
      deliveredDay: num(row.deliveredDay),
      closedDay: num(row.closedDay),
    },
  }
}
