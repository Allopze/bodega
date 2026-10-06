import "server-only"

import type { Session } from "next-auth"
import { and, asc, count, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  dispatchGuides,
  physicalInventoryCounts,
  purchaseOrders,
  worksites,
  worksiteStock,
} from "@/db/schema"
import { serviceWorksiteScope, worksiteScopeSql } from "@/lib/auth/scope"
import { countDeliverableEppItems } from "@/lib/services/epp-pending-delivery"
import { getStockAvailability } from "@/lib/services/stock-availability"
import { RECEIVABLE_ORDER_STATUSES } from "@/lib/work-queue-labels"

export interface BodegaAttention {
  /** Guías despachadas a una faena del alcance que ésta aún no confirma. */
  guides: { count: number; oldestSince: string | null }
  /** EPP recibido en faena con saldo por entregar y stock físico. */
  eppToDeliver: number
  /** Pares faena–producto en cero con algo pedido que aún no llega. */
  stockoutsWithDemand: number
  /** Conteos físicos sin cerrar, con la faena a la que pertenecen. */
  countDrafts: Array<{ worksiteId: string; worksiteName: string; count: number }>
  /** OC con una recepción pendiente en el alcance (alimenta la hoja de movimientos). */
  ordersToReceive: number
}

/**
 * "Sin stock con demanda" (BOD-03/BOD-05), definido barato y sin tabla nueva:
 *
 *   un par (faena, producto) cuyo saldo físico en `worksite_stock` es 0 —o no
 *   tiene registro— y que tiene algo **por recibir**: ítems de solicitud
 *   aprobados que todavía no llegan a esa faena (`getStockAvailability`, que ya
 *   excluye solicitudes terminales y servicios).
 *
 * Es decir, la faena pidió el producto, no lo tiene y no se lo ha entregado
 * nadie. Un saldo bajo pero positivo no cuenta: sin umbral mínimo (se retiraron
 * el 2026-10-02) no hay con qué compararlo, y el 0 es el único corte objetivo.
 */
export async function listStockoutsWithDemand(
  session: Session | null,
  faena: string,
): Promise<Array<{ worksiteId: string; productId: string }>> {
  const availability = await getStockAvailability(session, { worksiteId: faena || undefined })
  const pending = availability.filter((row) => row.incoming > 0)
  if (pending.length === 0) return []

  const withStock = await db
    .select({ worksiteId: worksiteStock.worksiteId, productId: worksiteStock.productId })
    .from(worksiteStock)
    .where(and(
      inArray(worksiteStock.worksiteId, [...new Set(pending.map((row) => row.worksiteId))]),
      inArray(worksiteStock.productId, [...new Set(pending.map((row) => row.productId))]),
      sql`${worksiteStock.quantity} > 0`,
    ))
  const covered = new Set(withStock.map((row) => `${row.worksiteId}\u0000${row.productId}`))
  return pending
    .filter((row) => !covered.has(`${row.worksiteId}\u0000${row.productId}`))
    .map((row) => ({ worksiteId: row.worksiteId, productId: row.productId }))
}

/**
 * Lo que la bodega tiene pendiente de hacer, respetando el alcance de faenas
 * del usuario y la faena que tiene a la vista (`""` = todas las visibles).
 */
export async function getBodegaAttention(
  session: Session,
  faena: string,
  /**
   * Faena que acota las guías por confirmar. Distinta de `faena` a propósito: una
   * guía siempre tiene como destino una faena, nunca la oficina, así que la
   * bodega propia de un usuario de oficina (la faena por defecto) las dejaría
   * siempre en 0 y el aviso no serviría de nada. Sólo una faena elegida a mano
   * las acota; `""` = todas las del alcance.
   */
  guidesFaena: string = faena,
): Promise<BodegaAttention> {
  const scope = serviceWorksiteScope(session)
  const eppScope = faena
    ? { worksiteIds: scope === "all" || scope.includes(faena) ? [faena] : [] }
    : { worksiteIds: scope }

  const [guideRow, eppToDeliver, stockouts, draftRows, orderRow] = await Promise.all([
    db
      .select({
        total: count(),
        // ISO en UTC y no el timestamp crudo del driver: `formatDateRelative`
        // lo interpreta igual en cualquier entorno.
        oldest: sql<string | null>`to_char(min(coalesce(${dispatchGuides.dispatchedAt}, ${dispatchGuides.issuedAt})) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
      })
      .from(dispatchGuides)
      .where(and(
        eq(dispatchGuides.status, "dispatched"),
        worksiteScopeSql(session, dispatchGuides.destinationWorksiteId, guidesFaena || undefined),
      )),
    countDeliverableEppItems(eppScope),
    listStockoutsWithDemand(session, faena),
    db
      .select({ worksiteId: physicalInventoryCounts.worksiteId, worksiteName: worksites.name, total: count() })
      .from(physicalInventoryCounts)
      .innerJoin(worksites, eq(worksites.id, physicalInventoryCounts.worksiteId))
      .where(and(
        eq(physicalInventoryCounts.status, "draft"),
        eq(worksites.isActive, true),
        worksiteScopeSql(session, physicalInventoryCounts.worksiteId, faena || undefined),
      ))
      .groupBy(physicalInventoryCounts.worksiteId, worksites.name)
      .orderBy(asc(worksites.name)),
    db
      .select({ total: count() })
      .from(purchaseOrders)
      .where(and(
        inArray(purchaseOrders.status, [...RECEIVABLE_ORDER_STATUSES]),
        worksiteScopeSql(session, purchaseOrders.worksiteId, faena || undefined),
      )),
  ])

  const oldest = guideRow[0]?.oldest
  return {
    guides: {
      count: Number(guideRow[0]?.total ?? 0),
      oldestSince: oldest ? String(oldest) : null,
    },
    eppToDeliver,
    stockoutsWithDemand: stockouts.length,
    countDrafts: draftRows.map((row) => ({
      worksiteId: row.worksiteId,
      worksiteName: row.worksiteName,
      count: Number(row.total),
    })),
    ordersToReceive: Number(orderRow[0]?.total ?? 0),
  }
}
