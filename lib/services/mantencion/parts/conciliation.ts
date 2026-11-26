import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  mantPartsAllocations, mantRecordParts, mantRecords, mantWorkOrderEvents, mantWorkOrders, products, worksiteStock, worksites,
} from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { hasMantPermission, type MantViewer } from "@/lib/services/mantencion/access"
import { activeReservationsTx, roundQty, toCents } from "@/lib/services/stock-reservations"
import { REASON_MAX_LENGTH } from "@/lib/validation/reason-thresholds"
import { lockForStockTx } from "./allocations"
import { consumePartTx } from "./consumption"
import { stockReservationSummary } from "./reads"
import { PartsValidationError, type ConciliateInput, type ConsumePartResult, type PartsActionResult, type PendingConciliationRow } from "./types"

/**
 * Conciliación de las líneas de un registro que quedaron «pendiente de conciliar» (ADR mantención
 * 0001, D6): el repuesto se usó pero la bodega de la faena no lo tenía al sincronizar. Quien
 * administra las notas de pedido (`mant:np:manage`, en la faena de la línea) resuelve cada una:
 *
 * - `aplicar`: descuenta de la bodega ahora (`egreso_mantencion`, el mismo camino del registro);
 * - `sin_movimiento`: la cierra sin mover stock, con motivo (se compró afuera, ya estaba descontado…).
 *
 * ORDEN DE BLOQUEO: registro (`FOR UPDATE`) → línea → OT → faena → filas de stock. El
 * `UPDATE … WHERE stock_status = 'pendiente_conciliar'` es la última defensa contra una doble
 * conciliación: si no encuentra la línea pendiente, la transacción entera —con su movimiento de
 * stock— se revierte.
 */

/** Igual que el CHECK `mant_record_parts_stock_status_valid` (5 caracteres del motivo de `sin_movimiento`). */
export const CONCILIATION_REASON_MIN_LENGTH = 5

const NOT_FOUND = "No encontramos esa línea de repuesto."
const ALREADY_DONE = "Esa línea ya estaba conciliada."
const RACE = "Otra persona ya concilió esta línea."

/** Se lanza para REVERTIR la transacción (el movimiento de stock ya se hizo) y volver como rechazo. */
class ConciliationAbort extends Error {}

const inScope = (viewer: MantViewer, worksiteId: string) => viewer.isGlobal || viewer.worksiteIds.includes(worksiteId)

function formatQty(quantity: number): string {
  return roundQty(quantity).toLocaleString("es-CL", { maximumFractionDigits: 2 })
}

export async function conciliatePart(viewer: MantViewer, input: ConciliateInput): Promise<PartsActionResult> {
  if (!hasMantPermission(viewer, "mant:np:manage")) return { ok: false, message: "No tienes permiso para conciliar repuestos." }
  let reason = ""
  if (input.mode === "sin_movimiento") {
    reason = (input.reason ?? "").trim()
    if (reason.length < CONCILIATION_REASON_MIN_LENGTH) {
      return { ok: false, field: "reason", message: `Escribe el motivo (al menos ${CONCILIATION_REASON_MIN_LENGTH} caracteres).` }
    }
    if (reason.length > REASON_MAX_LENGTH) return { ok: false, field: "reason", message: `El motivo es demasiado largo (máximo ${REASON_MAX_LENGTH} caracteres).` }
  }
  try {
    return await db.transaction((tx) => conciliateLocked(tx, viewer, input, reason))
  } catch (error) {
    if (error instanceof ConciliationAbort) return { ok: false, message: error.message }
    throw error
  }
}

async function conciliateLocked(tx: Tx, viewer: MantViewer, input: ConciliateInput, reason: string): Promise<PartsActionResult> {
  const [head] = await tx.select({ recordId: mantRecordParts.recordId }).from(mantRecordParts).where(eq(mantRecordParts.id, input.recordPartId)).limit(1)
  if (!head) return { ok: false, message: NOT_FOUND }
  const [record] = await tx
    .select({ id: mantRecords.id, folio: mantRecords.folio, status: mantRecords.status, worksiteId: mantRecords.worksiteId, workOrderId: mantRecords.workOrderId })
    .from(mantRecords)
    .where(eq(mantRecords.id, head.recordId))
    .for("update")
    .limit(1)
  const [line] = record
    ? await tx
      .select({
        id: mantRecordParts.id, productId: mantRecordParts.productId, quantity: mantRecordParts.quantity, allocationId: mantRecordParts.allocationId,
        source: mantRecordParts.source, stockStatus: mantRecordParts.stockStatus, description: mantRecordParts.description,
      })
      .from(mantRecordParts)
      .where(eq(mantRecordParts.id, input.recordPartId))
      .for("update")
      .limit(1)
    : []
  if (!record || !line) return { ok: false, message: NOT_FOUND }

  // La faena de la línea es donde se mueve su stock: la de su reserva si sigue activa; si no, la del registro.
  const [allocation] = line.allocationId
    ? await tx.select({ status: mantPartsAllocations.status, worksiteId: mantPartsAllocations.worksiteId }).from(mantPartsAllocations).where(eq(mantPartsAllocations.id, line.allocationId)).limit(1)
    : []
  const worksiteId = allocation?.status === "activa" ? allocation.worksiteId : record.worksiteId
  // Fuera del alcance se responde igual que si no existiera.
  if (!inScope(viewer, worksiteId)) return { ok: false, message: NOT_FOUND }
  if (record.status !== "vigente") return { ok: false, message: `El registro ${record.folio ?? "sin folio"} está anulado: ya no hay nada que conciliar.` }
  if (line.stockStatus !== "pendiente_conciliar") return { ok: false, message: ALREADY_DONE }

  const audited = { id: line.id, recordFolio: record.folio, worksiteId }
  if (input.mode === "sin_movimiento") {
    const [closed] = await tx.update(mantRecordParts)
      .set({ stockStatus: "sin_movimiento", stockNote: reason })
      .where(and(eq(mantRecordParts.id, line.id), eq(mantRecordParts.stockStatus, "pendiente_conciliar")))
      .returning({ id: mantRecordParts.id })
    if (!closed) throw new ConciliationAbort(RACE)
    await touchAndAudit(tx, viewer, record.id, audited, { stockStatus: "sin_movimiento", stockNote: reason }, reason)
    return { ok: true, message: "Línea cerrada sin mover stock." }
  }

  if (!record.workOrderId || !line.productId || line.source !== "stock") {
    return { ok: false, message: "Esta línea no es un repuesto de la bodega enlazado a una orden de trabajo: no hay stock que descontar." }
  }
  const quantity = roundQty(Number(line.quantity))
  let result: ConsumePartResult
  try {
    result = await consumePartTx(tx, {
      recordId: record.id,
      workOrderId: record.workOrderId,
      recordWorksiteId: record.worksiteId,
      productId: line.productId,
      allocationId: line.allocationId,
      quantity,
      actorUserId: viewer.userId,
      userEmail: viewer.email ?? undefined,
    })
  } catch (error) {
    if (error instanceof PartsValidationError) return { ok: false, message: error.message, ...(error.field ? { field: error.field } : {}) }
    throw error
  }
  // Sigue faltando (o la faena ya no está activa): `consumePartTx` no escribió nada, la línea sigue pendiente.
  if (result.status === "pendiente_conciliar") {
    return { ok: false, message: await stillMissingMessage(tx, line.productId, quantity, result) }
  }

  const [applied] = await tx.update(mantRecordParts)
    .set({ stockStatus: "descontado", inventoryMovementId: result.movementId, allocationId: result.allocationId, stockNote: null })
    .where(and(eq(mantRecordParts.id, line.id), eq(mantRecordParts.stockStatus, "pendiente_conciliar")))
    .returning({ id: mantRecordParts.id })
  if (!applied) throw new ConciliationAbort(RACE)

  await tx.insert(mantWorkOrderEvents).values({
    id: nanoid(),
    workOrderId: record.workOrderId,
    type: "parts_consumed",
    changeSet: {
      recordId: record.id,
      folio: record.folio,
      conciliated: true,
      items: [{
        recordPartId: line.id, productId: line.productId, description: line.description, quantity, status: "descontado",
        allocationId: result.allocationId, worksiteId: result.worksiteId, movementId: result.movementId,
      }],
    },
    actorUserId: viewer.userId,
  })
  await touchAndAudit(
    tx, viewer, record.id, { ...audited, worksiteId: result.worksiteId },
    { stockStatus: "descontado", inventoryMovementId: result.movementId }, "Conciliación: se descontó de la bodega",
  )
  return { ok: true, message: "Repuesto descontado de la bodega." }
}

/** «Todavía faltan 2 en Biodiversa.»: lo que falta HOY, con la misma cuenta del descuento (stock menos lo reservado para otras OT). */
async function stillMissingMessage(
  tx: Tx,
  productId: string,
  quantity: number,
  result: Extract<ConsumePartResult, { status: "pendiente_conciliar" }>,
): Promise<string> {
  const locks = await lockForStockTx(tx, { worksiteId: result.worksiteId, productIds: [productId] })
  if (!locks.worksite?.isActive) return result.note
  const stock = locks.stock.get(productId) ?? 0
  const reservations = await activeReservationsTx(tx, result.worksiteId, productId)
  const othersReserved = roundQty(reservations.filter((row) => row.allocationId !== result.allocationId).reduce((sum, row) => sum + row.remaining, 0))
  const missing = roundQty(quantity - Math.max(0, stock - othersReserved))
  return toCents(missing) > 0 ? `Todavía faltan ${formatQty(missing)} en ${locks.worksite.name}.` : result.note
}

/** El ETag del catálogo del teléfono depende de `mant_records.updated_at`: la conciliación lo mueve. Deja la bitácora. */
async function touchAndAudit(
  tx: Tx,
  viewer: MantViewer,
  recordId: string,
  line: { id: string; recordFolio: string | null; worksiteId: string },
  newState: Record<string, unknown>,
  reason: string,
): Promise<void> {
  await tx.update(mantRecords).set({ updatedAt: sql`now()` }).where(eq(mantRecords.id, recordId))
  await recordAudit({
    userId: viewer.userId,
    userEmail: viewer.email ?? undefined,
    action: "update",
    entityType: "mant_record_part",
    entityId: line.id,
    entityCode: line.recordFolio ?? undefined,
    worksiteId: line.worksiteId,
    oldState: { stockStatus: "pendiente_conciliar" },
    newState,
    reason,
  }, tx)
}

const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 200

/**
 * Las líneas pendientes de conciliar de registros vigentes, dentro del alcance de quien mira
 * (rol global: todas; si no, las de sus faenas asignadas). Ver exige `mant:np:manage` o
 * `mant:np:view_worksite`; actuar (`conciliatePart`) sólo el primero. Lectura sin bloqueos, de la
 * más antigua a la más reciente: es una cola de trabajo.
 *
 * `freeNow` es el stock menos todo lo reservado para OT en esa bodega, no el cupo de ESTA línea:
 * si su propia OT tiene reserva sin usar, «aplicar» puede funcionar aunque `freeNow` sea menor que
 * la cantidad. La pantalla lo muestra como contexto; no debe deshabilitar «aplicar» por él.
 */
export async function listPendingConciliation(
  viewer: MantViewer,
  filters: { worksiteId?: string; page?: number; pageSize?: number },
): Promise<{ rows: PendingConciliationRow[]; total: number }> {
  const empty = { rows: [], total: 0 }
  if (!hasMantPermission(viewer, "mant:np:manage") && !hasMantPermission(viewer, "mant:np:view_worksite")) return empty
  if (!viewer.isGlobal && viewer.worksiteIds.length === 0) return empty

  // Faena de la línea: la de su reserva si sigue activa; si no, la del registro (igual que `conciliatePart`).
  const lineWorksite = sql<string>`case when ${mantPartsAllocations.status} = 'activa' then ${mantPartsAllocations.worksiteId} else ${mantRecords.worksiteId} end`
  const conditions: SQL[] = [
    eq(mantRecordParts.stockStatus, "pendiente_conciliar"),
    eq(mantRecords.status, "vigente"),
  ]
  if (!viewer.isGlobal) conditions.push(sql`${lineWorksite} in (${sql.join(viewer.worksiteIds.map((id) => sql`${id}`), sql`, `)})`)
  if (filters.worksiteId) conditions.push(sql`${lineWorksite} = ${filters.worksiteId}`)
  const where = and(...conditions)

  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(filters.pageSize ?? DEFAULT_PAGE_SIZE)))
  const page = Math.max(1, Math.trunc(filters.page ?? 1))
  const [pageRows, [count]] = await Promise.all([
    db
      .select({
        recordPartId: mantRecordParts.id,
        recordId: mantRecords.id,
        recordFolio: mantRecords.folio,
        workOrderId: mantRecords.workOrderId,
        workOrderFolio: mantWorkOrders.folio,
        worksiteId: lineWorksite,
        productId: mantRecordParts.productId,
        productName: products.name,
        quantity: mantRecordParts.quantity,
        note: mantRecordParts.stockNote,
        signedAt: mantRecords.signedAt,
      })
      .from(mantRecordParts)
      .innerJoin(mantRecords, eq(mantRecords.id, mantRecordParts.recordId))
      .innerJoin(products, eq(products.id, mantRecordParts.productId))
      .leftJoin(mantWorkOrders, eq(mantWorkOrders.id, mantRecords.workOrderId))
      .leftJoin(mantPartsAllocations, eq(mantPartsAllocations.id, mantRecordParts.allocationId))
      .where(where)
      .orderBy(asc(mantRecords.signedAt), asc(mantRecordParts.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(mantRecordParts)
      .innerJoin(mantRecords, eq(mantRecords.id, mantRecordParts.recordId))
      .leftJoin(mantPartsAllocations, eq(mantPartsAllocations.id, mantRecordParts.allocationId))
      .where(where),
  ])
  const total = count?.total ?? 0
  if (pageRows.length === 0) return { rows: [], total }

  const worksiteIds = [...new Set(pageRows.map((row) => row.worksiteId))]
  const productIds = [...new Set(pageRows.map((row) => row.productId as string))]
  const [names, stocks, reservations] = await Promise.all([
    db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, worksiteIds)),
    db.select({ worksiteId: worksiteStock.worksiteId, productId: worksiteStock.productId, quantity: worksiteStock.quantity })
      .from(worksiteStock)
      .where(and(inArray(worksiteStock.worksiteId, worksiteIds), inArray(worksiteStock.productId, productIds))),
    stockReservationSummary({ worksiteIds, productIds }),
  ])
  const nameOf = new Map(names.map((row) => [row.id, row.name]))
  const key = (worksiteId: string, productId: string) => `${worksiteId}:${productId}`
  const stockOf = new Map(stocks.map((row) => [key(row.worksiteId, row.productId), roundQty(Number(row.quantity))]))
  const reservedOf = new Map(reservations.map((row) => [key(row.worksiteId, row.productId), row.reserved]))

  return {
    total,
    rows: pageRows.map((row) => {
      const productId = row.productId as string
      const free = Math.max(0, roundQty((stockOf.get(key(row.worksiteId, productId)) ?? 0) - (reservedOf.get(key(row.worksiteId, productId)) ?? 0)))
      return {
        recordPartId: row.recordPartId,
        recordId: row.recordId,
        recordFolio: row.recordFolio,
        workOrderId: row.workOrderId,
        workOrderFolio: row.workOrderFolio,
        worksiteId: row.worksiteId,
        worksiteName: nameOf.get(row.worksiteId) ?? "",
        productId,
        productName: row.productName,
        quantity: Number(row.quantity),
        freeNow: free,
        note: row.note,
        signedAt: row.signedAt,
      }
    }),
  }
}
