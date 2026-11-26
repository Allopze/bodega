import { stockReservationSummary } from "@/lib/services/mantencion/parts"
import { roundQty } from "@/lib/services/stock-reservations"

/**
 * «Reservado OT» y «Libre» de las filas de repuesto de Bodega (ADR mantención 0001).
 *
 * Los repuestos tienen stock por faena y lo que llega para una OT queda apartado para ella
 * (`mant_parts_allocations`). Lo reservado se calcula (`stockReservationSummary`: no hay columna en
 * `worksite_stock`), y lo libre es el saldo menos lo reservado, nunca negativo. Un producto que
 * no es repuesto no tiene reservas: no entra en el resultado y su fila no cambia.
 *
 * Es sólo lectura y sin bloqueos: las vistas muestran una foto; las decisiones de stock (consumir,
 * liberar) leen lo mismo bajo el bloqueo de la fila de stock, en `mantencion/parts`.
 */

export const stockLevelKey = (worksiteId: string, productId: string): string => `${worksiteId}\u0000${productId}`

export interface SpareStockLevel {
  /** Lo apartado para órdenes de trabajo abiertas y aún sin usar. */
  reserved: number
  /** `En bodega − Reservado OT`: lo que se puede usar sin quitárselo a una OT. */
  free: number
}

export async function loadSpareStockLevels(
  rows: ReadonlyArray<{ worksiteId: string; productId: string; quantity: number; isSparePart?: boolean }>,
): Promise<Map<string, SpareStockLevel>> {
  const spare = rows.filter((row) => row.isSparePart === true)
  const levels = new Map<string, SpareStockLevel>()
  if (spare.length === 0) return levels

  const reservations = await stockReservationSummary({
    worksiteIds: [...new Set(spare.map((row) => row.worksiteId))],
    productIds: [...new Set(spare.map((row) => row.productId))],
  })
  const reservedByKey = new Map(reservations.map((row) => [stockLevelKey(row.worksiteId, row.productId), row.reserved]))
  for (const row of spare) {
    const key = stockLevelKey(row.worksiteId, row.productId)
    const reserved = reservedByKey.get(key) ?? 0
    levels.set(key, { reserved, free: Math.max(0, roundQty(row.quantity - reserved)) })
  }
  return levels
}
