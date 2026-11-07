import type { Session } from "next-auth"
import { and, eq, inArray, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrderItems, purchaseOrders, purchaseRequestItems } from "@/db/schema"
import { can } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
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
      ne(purchaseOrderItems.status, "cancelled"),
      issuedOrderPredicate(),
      worksiteScopeSql(session, purchaseOrders.worksiteId),
      // `issued_at` es texto y puede traer hora: se compara el día civil, como el
      // libro del proveedor en `getAssetFuelSummary`.
      sql`left(${purchaseOrders.issuedAt}, 10) >= ${period.from}`,
      sql`left(${purchaseOrders.issuedAt}, 10) <= ${period.to}`,
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
