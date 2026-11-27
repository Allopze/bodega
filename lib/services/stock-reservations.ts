/**
 * Reservas de repuestos por OT: cálculos y guardas de bajo nivel.
 *
 * ADR `docs/mantencion/adr/0001-repuestos-con-stock-y-notas-de-pedido.md`.
 * Este módulo NO importa el motor de stock (`stock-movement.ts`): el motor lo
 * llama a él. Lo de más arriba (crear, consumir, liberar) vive en
 * `lib/services/mantencion/parts/allocations.ts`.
 *
 * Cálculos (siempre bajo el bloqueo de la fila (faena, producto) de `worksite_stock`):
 *  - consumido(A) = Σ líneas de registro con `allocation_id = A` y `descontado`.
 *  - restante(A)  = A activa ? max(0, A.quantity − consumido(A)) : 0.
 *  - reservado    = Σ restante de las reservas activas de (faena, producto).
 *  - libre        = max(0, stock − reservado).
 *
 * Las cantidades se comparan en centésimas: `worksite_stock.quantity` es `real`
 * (float4) y su resolución (~6e-5 cerca de 1000) queda sobre el `1e-9` que usa el
 * resto del repo.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm"
import type { Tx } from "@/db"
import { mantPartsAllocations, mantPartsAllocationSources, mantRecordParts, mantWorkOrders, worksiteStock } from "@/db/schema"
import { nanoid } from "@/lib/id"

/** Cantidad en centésimas enteras, para comparar sin deriva de punto flotante. */
export function toCents(quantity: number): number {
  return Math.round(quantity * 100)
}

/** Redondea a centésimas (la escala de `numeric(10,2)`). */
export function roundQty(quantity: number): number {
  return toCents(quantity) / 100
}

/** Consumido de una reserva: subconsulta correlacionada con `mant_parts_allocations`. */
export const consumedSql = sql<number>`coalesce((
  select sum(${mantRecordParts.quantity}) from ${mantRecordParts}
  where ${mantRecordParts.allocationId} = ${mantPartsAllocations.id}
    and ${mantRecordParts.stockStatus} = 'descontado'
), 0)`.mapWith(Number)

/** Restante de una reserva (0 si está liberada). */
export const remainingSql = sql<number>`case when ${mantPartsAllocations.status} = 'activa'
  then greatest(0, ${mantPartsAllocations.quantity} - ${consumedSql}) else 0 end`.mapWith(Number)

export type ActiveReservation = {
  allocationId: string
  workOrderId: string
  workOrderFolio: string
  quantity: number
  remaining: number
  createdAt: string
}

/** Reservas activas de (faena, producto) con su restante, de la más nueva a la más vieja. */
export async function activeReservationsTx(tx: Tx, worksiteId: string, productId: string): Promise<ActiveReservation[]> {
  const rows = await tx
    .select({
      allocationId: mantPartsAllocations.id,
      workOrderId: mantPartsAllocations.workOrderId,
      workOrderFolio: mantWorkOrders.folio,
      quantity: mantPartsAllocations.quantity,
      remaining: remainingSql,
      createdAt: mantPartsAllocations.createdAt,
    })
    .from(mantPartsAllocations)
    .innerJoin(mantWorkOrders, eq(mantWorkOrders.id, mantPartsAllocations.workOrderId))
    .where(and(
      eq(mantPartsAllocations.status, "activa"),
      eq(mantPartsAllocations.worksiteId, worksiteId),
      eq(mantPartsAllocations.productId, productId),
    ))
    .orderBy(desc(mantPartsAllocations.createdAt), desc(mantPartsAllocations.id))
  return rows.map((row) => ({ ...row, quantity: Number(row.quantity), remaining: roundQty(Number(row.remaining)) }))
}

/** Σ restante de las reservas activas de (faena, producto). */
export async function reservedQuantityTx(tx: Tx, worksiteId: string, productId: string): Promise<number> {
  const rows = await activeReservationsTx(tx, worksiteId, productId)
  return roundQty(rows.reduce((sum, row) => sum + row.remaining, 0))
}

/** Bloquea (FOR UPDATE) la fila de stock si existe y devuelve su cantidad (0 si no existe). */
export async function lockedStockQuantityTx(tx: Tx, worksiteId: string, productId: string): Promise<number> {
  const [row] = await tx
    .select({ quantity: worksiteStock.quantity })
    .from(worksiteStock)
    .where(and(eq(worksiteStock.worksiteId, worksiteId), eq(worksiteStock.productId, productId)))
    .for("update")
  return roundQty(Number(row?.quantity ?? 0))
}

/** Tipos de movimiento que un repuesto admite. El resto (entrega, devolución o retiro de un trabajador) no. */
export const SPARE_PART_MOVEMENT_TYPES = new Set<string>([
  "ingreso_oc",
  "egreso_mantencion",
  "ingreso_anulacion",
  "egreso_anulacion",
  "ajuste",
  "egreso_desecho",
  "egreso_traslado",
  "ingreso_traslado",
])

export const SPARE_PART_FORBIDDEN_MESSAGE =
  "Un repuesto sólo sale de bodega al usarse en una orden de trabajo: no se entrega, devuelve ni retira a un trabajador."

/** Salida de un repuesto que no es consumo en una OT: debe respetar lo reservado. */
export function isReservationCheckedEgress(type: string, quantity: number): boolean {
  if (type === "egreso_desecho" || type === "egreso_traslado" || type === "egreso_anulacion") return true
  return type === "ajuste" && quantity < 0
}

function formatQty(quantity: number): string {
  return roundQty(quantity).toLocaleString("es-CL", { maximumFractionDigits: 2 })
}

/**
 * Cómo repartir entre líneas de nota de pedido lo que un ajuste le quita a una reserva (ADR 0001 D21): filas de origen
 * `ajuste`, una por línea que cede y una sin línea (`noteItemId: null`) por lo que no es de ninguna. Suman `quantity`.
 * Lo inyecta quien llama (`applyMovementTx`) para que este módulo siga sin importar las notas de pedido.
 */
export type PlanAllocationCut = (tx: Tx, input: {
  allocationId: string
  workOrderId: string
  quantity: number
}) => Promise<Array<{ noteItemId: string | null; quantity: number }>>

/**
 * Guarda de las salidas de un repuesto que no son consumo (desecho, traslado,
 * anulación de recepción o guía, ajuste negativo). Corre dentro de
 * `applyMovementTx`, después del bloqueo de la faena.
 *
 * - Si la salida deja el stock por debajo de lo reservado: se rechaza con un
 *   mensaje que nombra las OT, salvo el `ajuste`.
 * - El `ajuste` (conteo físico o documento) manda: la realidad física es la que
 *   es. Rebaja reservas de la más nueva a la más vieja hasta cuadrar, con una
 *   fila de origen `ajuste` por cada una. No escribe eventos de OT ni toca las
 *   líneas de nota: tomaría un bloqueo sobre la OT después del de stock y
 *   rompería el orden global. Con `planCut`, cada fila lleva la línea a la que se
 *   atribuye (sólo lectura); devolver las líneas a pendiente y recalcular las notas
 *   se hace después del commit, con los bloqueos en orden
 *   (`parts-notes/line-reconcile.ts`).
 */
export async function guardSparePartEgressTx(tx: Tx, input: {
  worksiteId: string
  productId: string
  type: string
  quantity: number
  performedBy: string
  reason?: string | null
  planCut?: PlanAllocationCut
}): Promise<void> {
  const current = await lockedStockQuantityTx(tx, input.worksiteId, input.productId)
  const requested = input.type === "egreso_desecho" ? Math.abs(input.quantity) : -input.quantity
  const deduct = input.type === "egreso_desecho" ? Math.min(requested, Math.max(current, 0)) : requested
  const after = roundQty(current - deduct)
  const reservations = await activeReservationsTx(tx, input.worksiteId, input.productId)
  const reserved = roundQty(reservations.reduce((sum, row) => sum + row.remaining, 0))
  if (toCents(after) >= toCents(reserved)) return

  if (input.type !== "ajuste") {
    const folios = reservations.filter((row) => row.remaining > 0).map((row) => row.workOrderFolio)
    throw new Error(
      `No se puede: ${formatQty(reserved)} de este repuesto están reservados para ${folios.join(", ")}. `
      + "Libera la reserva antes de sacarlo de la bodega.",
    )
  }

  let toRelease = roundQty(reserved - Math.max(after, 0))
  for (const row of reservations) {
    if (toCents(toRelease) <= 0) break
    if (row.remaining <= 0) continue
    const cut = roundQty(Math.min(row.remaining, toRelease))
    // A qué líneas se atribuye lo que baja (se lee antes de escribir: el reparto parte de la reserva tal como estaba).
    const shares = input.planCut
      ? await input.planCut(tx, { allocationId: row.allocationId, workOrderId: row.workOrderId, quantity: cut })
      : [{ noteItemId: null, quantity: cut }]
    await tx.update(mantPartsAllocations)
      .set({ quantity: sql`${mantPartsAllocations.quantity} - ${cut}`, updatedAt: new Date().toISOString() })
      .where(eq(mantPartsAllocations.id, row.allocationId))
    for (const share of shares) {
      await tx.insert(mantPartsAllocationSources).values({
        id: nanoid(),
        allocationId: row.allocationId,
        source: "ajuste",
        quantity: -share.quantity,
        noteItemId: share.noteItemId,
        actorUserId: input.performedBy,
        reason: input.reason?.trim() || "Ajuste de inventario",
      })
    }
    toRelease = roundQty(toRelease - cut)
  }
}

/** Reservado por (faena, producto) para varias filas a la vez (vistas de Bodega). */
export async function reservedByStockKeyTx(
  tx: Pick<Tx, "select">,
  filters: { worksiteIds?: readonly string[]; productIds?: readonly string[] } = {},
): Promise<Array<{ worksiteId: string; productId: string; reserved: number }>> {
  const conditions = [eq(mantPartsAllocations.status, "activa")]
  if (filters.worksiteIds?.length) conditions.push(inArray(mantPartsAllocations.worksiteId, [...filters.worksiteIds]))
  if (filters.productIds?.length) conditions.push(inArray(mantPartsAllocations.productId, [...filters.productIds]))
  const rows = await tx
    .select({
      worksiteId: mantPartsAllocations.worksiteId,
      productId: mantPartsAllocations.productId,
      reserved: sql<number>`sum(${remainingSql})`.mapWith(Number),
    })
    .from(mantPartsAllocations)
    .where(and(...conditions))
    .groupBy(mantPartsAllocations.worksiteId, mantPartsAllocations.productId)
  return rows.map((row) => ({ ...row, reserved: roundQty(Number(row.reserved)) })).filter((row) => row.reserved > 0)
}
