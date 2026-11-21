import type { Session } from "next-auth"
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrderItems, purchaseOrders, purchaseRequestItems } from "@/db/schema"
import { can } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { isoTextDaySql } from "@/lib/combustibles/control/queries/field-filters"
import type { DatedCost } from "@/lib/contracts/cost-attribution"
import { notPersonalUseOnDaySql } from "@/lib/fleet/personal-use-sql"
import { issuedOrderPredicate } from "@/lib/services/operational-period-metrics"

/**
 * Lo comprado para cada equipo de flota, para el costo por equipo del Panel
 * operacional (plan «Repuestos vinculados al equipo y a la OT»).
 *
 * El vínculo es `purchase_request_items.vehicle_id`: la solicitud de repuestos
 * o servicios nombra el equipo y la línea de OC que la atiende hereda ese
 * vínculo por `request_item_id`. Una línea de OC sin ítem de solicitud (compra
 * de bodega) o de una solicitud sin vehículo no es de ningún equipo y no suma.
 *
 * Se suma `purchase_order_items.subtotal` —neto de descuento y sin IVA, igual
 * que el resto de las cifras de gasto— de las líneas no anuladas de las OC que
 * `issuedOrderPredicate` define como emitidas (no anulada, no eliminada, con
 * fecha de emisión): la misma definición que usan el Resumen, Adquisiciones y
 * Finanzas, para que el panel no cuente una compra que el Tablero no cuenta. El
 * período es el de la **emisión** de la OC, no el de la recepción ni el de la
 * factura. Una línea con costo pendiente (`subtotal` nulo) no aporta monto.
 *
 * Modelado sobre `getAssetFuelSummary`: ids sin repetir, una sola consulta
 * agrupada por vehículo (nunca una por fila), mapa prellenado con ceros y alcance
 * de faena de la **OC** aplicado en la consulta.
 */
export interface VehiclePurchaseSummary {
  vehicleId: string
  /** Σ subtotal de las líneas de OC vinculadas al equipo, emitidas en el período. */
  purchaseAmount: number
  /** OC distintas que aportan al monto. */
  orderCount: number
  /** Fecha de emisión (ISO) de la OC más reciente que aporta; `null` sin compras. */
  lastOrderAt: string | null
}

function emptySummary(vehicleId: string): VehiclePurchaseSummary {
  return { vehicleId, purchaseAmount: 0, orderCount: 0, lastOrderAt: null }
}

/**
 * Condiciones de una línea de OC que cuenta como gasto del período: UNA sola
 * definición, compartida por el resumen por equipo, el detalle por día y las
 * compras sin equipo. Línea no anulada, de una OC emitida (`issuedOrderPredicate`),
 * con emisión en el período (día civil: `issued_at` es texto y puede traer hora,
 * como el libro del proveedor en `getAssetFuelSummary`) y dentro del alcance de
 * faena de la **OC**. Quien la use debe unir `purchase_orders`.
 *
 * Uso personal: se omite la línea cuyo equipo (el del ítem de solicitud) estaba en
 * uso personal el día de emisión de la OC, en día calendario de Chile. Una línea sin
 * equipo (`vehicle_id` nulo) pasa. Sus únicos llamadores son Control operacional y
 * Costo por contrato; Mantención no la usa (suma las compras del equipo por su lado).
 */
function countedOrderLineWhere(session: Session, period: { from: string; to: string }) {
  return and(
    ne(purchaseOrderItems.status, "cancelled"),
    issuedOrderPredicate(),
    worksiteScopeSql(session, purchaseOrders.worksiteId),
    sql`left(${purchaseOrders.issuedAt}, 10) >= ${period.from}`,
    sql`left(${purchaseOrders.issuedAt}, 10) <= ${period.to}`,
    notPersonalUseOnDaySql(purchaseRequestItems.vehicleId, sql`to_char(${isoTextDaySql(purchaseOrders.issuedAt)}, 'YYYY-MM-DD')`),
  )
}

/**
 * Los costos de compras se protegen con `purchasing:view` (no existe un permiso
 * de costos de compras aparte). Sin él devuelve el mapa **vacío** sin consultar:
 * el llamador distingue «sin capacidad» (no hay entrada) de «sin compras»
 * (entrada en 0) y pinta «—» en el primer caso.
 */
export async function getVehiclePurchaseSummary(
  session: Session,
  period: { from: string; to: string },
  vehicleIds: readonly string[],
): Promise<Map<string, VehiclePurchaseSummary>> {
  if (!can(session, "purchasing:view")) return new Map()
  const ids = [...new Set(vehicleIds)]
  const out = new Map(ids.map((id) => [id, emptySummary(id)]))
  if (ids.length === 0) return out

  const rows = await db.select({
    vehicleId: purchaseRequestItems.vehicleId,
    purchaseAmount: sql<number>`COALESCE(SUM(${purchaseOrderItems.subtotal}), 0)::float8`,
    orderCount: sql<number>`COUNT(DISTINCT ${purchaseOrders.id})::int`,
    lastOrderAt: sql<string | null>`MAX(${purchaseOrders.issuedAt})`,
  })
    .from(purchaseOrderItems)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId))
    .innerJoin(purchaseRequestItems, eq(purchaseRequestItems.id, purchaseOrderItems.requestItemId))
    .where(and(
      inArray(purchaseRequestItems.vehicleId, ids),
      countedOrderLineWhere(session, period),
    ))
    .groupBy(purchaseRequestItems.vehicleId)

  for (const row of rows) {
    if (!row.vehicleId) continue
    const entry = out.get(row.vehicleId)
    if (!entry) continue
    entry.purchaseAmount = Number(row.purchaseAmount ?? 0)
    entry.orderCount = Number(row.orderCount ?? 0)
    entry.lastOrderAt = row.lastOrderAt
  }

  return out
}

/**
 * Lo comprado por equipo y día de emisión de la OC, con la misma definición que
 * `getVehiclePurchaseSummary` (ver `countedOrderLineWhere`). Una sola consulta
 * agrupada por equipo y día. Sin `purchasing:view` devuelve `[]`.
 */
export async function getVehiclePurchaseByDay(
  session: Session,
  period: { from: string; to: string },
  vehicleIds: readonly string[],
): Promise<DatedCost[]> {
  if (!can(session, "purchasing:view")) return []
  const ids = [...new Set(vehicleIds)]
  if (ids.length === 0) return []
  const day = sql<string>`left(${purchaseOrders.issuedAt}, 10)`
  const rows = await db.select({
    vehicleId: purchaseRequestItems.vehicleId,
    day,
    amount: sql<number>`COALESCE(SUM(${purchaseOrderItems.subtotal}), 0)::float8`,
  })
    .from(purchaseOrderItems)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId))
    .innerJoin(purchaseRequestItems, eq(purchaseRequestItems.id, purchaseOrderItems.requestItemId))
    .where(and(
      inArray(purchaseRequestItems.vehicleId, ids),
      countedOrderLineWhere(session, period),
    ))
    .groupBy(purchaseRequestItems.vehicleId, day)
  return rows.flatMap((row) =>
    row.vehicleId
      ? [{
          vehicleId: row.vehicleId,
          day: row.day,
          amount: Number(row.amount ?? 0),
          component: "purchases" as const,
          spansMonth: false,
        }]
      : [],
  )
}

/**
 * Compras emitidas en el período que no son de ningún equipo: líneas sin ítem de
 * solicitud (compra de bodega) o cuyo ítem no nombra equipo. Agrupadas por la
 * faena de la OC, con la misma definición de línea contada que el resumen por
 * equipo. Sin `purchasing:view` devuelve un mapa vacío.
 */
export async function getWorksitePurchasesWithoutVehicle(
  session: Session,
  period: { from: string; to: string },
): Promise<Map<string, number>> {
  if (!can(session, "purchasing:view")) return new Map()
  const rows = await db.select({
    worksiteId: purchaseOrders.worksiteId,
    amount: sql<number>`COALESCE(SUM(${purchaseOrderItems.subtotal}), 0)::float8`,
  })
    .from(purchaseOrderItems)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId))
    .leftJoin(purchaseRequestItems, eq(purchaseRequestItems.id, purchaseOrderItems.requestItemId))
    .where(and(
      isNull(purchaseRequestItems.vehicleId),
      countedOrderLineWhere(session, period),
    ))
    .groupBy(purchaseOrders.worksiteId)
  const out = new Map<string, number>()
  for (const row of rows) {
    if (!row.worksiteId) continue
    out.set(row.worksiteId, Number(row.amount ?? 0))
  }
  return out
}
