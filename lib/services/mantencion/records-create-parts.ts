import { inArray } from "drizzle-orm"
import type { Tx } from "@/db"
import { products } from "@/db/schema"
import type { SyncCorrectiveRecord } from "@/lib/mantencion/contracts"
import { nanoid } from "@/lib/id"
import { roundQty } from "@/lib/services/stock-reservations"
import { consumePartTx, PartsValidationError, type RecordPartSource, type RecordPartStockStatus } from "./parts"

/**
 * Repuestos de un registro (ADR mantención 0001): decide, bajo bloqueo, qué línea descuenta de la
 * bodega de la faena y cuál queda «pendiente de conciliar». Lo llama `createRecord` DESPUÉS de
 * enlazar la OT (ya bloqueada `FOR UPDATE`) y ANTES de `nextFolio` (regla 8 del plan): con el
 * folio ya tomado, un rechazo tardío dejaría el contador bloqueado más de lo necesario.
 *
 * Nada de lo que hay aquí rechaza un registro por FALTA de stock (D6): eso es
 * `pendiente_conciliar`. Lo único que rechaza es un dato inválido (una reserva de otra OT, un
 * producto que no es repuesto, una cantidad fraccionaria en un repuesto entero, `stock` sin OT).
 */

/**
 * Rechazo (422) de una línea de repuesto. Se LANZA, no se devuelve: cuando salta, las líneas
 * anteriores del mismo registro ya pueden haber descontado stock, y sólo revertir la
 * transacción lo deshace. `createRecord` lo traduce a la respuesta del teléfono.
 */
export class PartRejection extends Error {
  constructor(message: string, readonly field: string) {
    super(message)
    this.name = "PartRejection"
  }
}

export const STOCK_NEEDS_WORK_ORDER = "Para descontar de la bodega, el registro debe estar enlazado a una orden de trabajo."
export const NOT_A_SPARE_PART = "Ese producto no es un repuesto del catálogo."

export const partField = (jobIndex: number, partIndex: number, field: string) => `jobs.${jobIndex}.parts.${partIndex}.${field}`

/** Una línea del registro tal como se inserta en `mant_record_parts`. */
export interface PartLine {
  id: string
  jobIndex: number
  partIndex: number
  /** Redondeada a centésimas en las líneas de stock: es lo que se descontó y lo que guarda `numeric(10,2)`. */
  quantity: number
  source: RecordPartSource
  productId: string | null
  allocationId: string | null
  inventoryMovementId: string | null
  stockStatus: RecordPartStockStatus
  stockNote: string | null
}

export interface PendingStockLine {
  recordPartId: string
  productId: string
  worksiteId: string
}

export interface RecordPartsPlan {
  /** Por `jobIndex:partIndex`. */
  lines: Map<string, PartLine>
  /** Líneas de stock que quedaron pendientes: avisan a quienes concilian, después del commit. */
  pending: PendingStockLine[]
  /** Lo que el evento `parts_consumed` de la OT cuenta de las líneas de stock (sin folio: lo pone quien inserta). */
  eventItems: Array<Record<string, unknown>>
}

export const lineKey = (jobIndex: number, partIndex: number) => `${jobIndex}:${partIndex}`

export const NO_PARTS: RecordPartsPlan = { lines: new Map(), pending: [], eventItems: [] }

/**
 * Descuenta las líneas `stock` y arma el resto. Las líneas de stock se consumen ordenadas por
 * `product_id`: es el orden global de bloqueo de las filas de `worksite_stock`, así dos registros
 * con los mismos repuestos en distinto orden no se esperan entre sí.
 */
export async function consumeRecordParts(
  tx: Tx,
  input: SyncCorrectiveRecord,
  context: { recordWorksiteId: string; workOrderId: string | null; actorUserId: string; userEmail?: string },
): Promise<RecordPartsPlan> {
  const lines = new Map<string, PartLine>()
  const stock: Array<{ line: PartLine; allocationId: string | null }> = []
  const externalProducts = new Set<string>()

  input.jobs.forEach((job, jobIndex) => job.parts.forEach((part, partIndex) => {
    const source: RecordPartSource = part.source ?? "texto"
    const line: PartLine = {
      id: nanoid(), jobIndex, partIndex, quantity: part.quantity, source,
      productId: null, allocationId: null, inventoryMovementId: null, stockStatus: "no_aplica", stockNote: null,
    }
    lines.set(lineKey(jobIndex, partIndex), line)
    // Sin `source` es el texto libre de siempre (teléfonos sin actualizar): no se toca el producto ni la reserva.
    if (source === "externo" && part.productId) {
      line.productId = part.productId
      externalProducts.add(part.productId)
    }
    if (source === "stock") {
      if (!context.workOrderId) throw new PartRejection(STOCK_NEEDS_WORK_ORDER, partField(jobIndex, partIndex, "source"))
      // El contrato ya lo exige; el servicio no confía en quien lo llame.
      if (!part.productId) throw new PartRejection("Elige el repuesto de la bodega.", partField(jobIndex, partIndex, "productId"))
      line.productId = part.productId
      stock.push({ line, allocationId: part.allocationId ?? null })
    }
  }))

  await checkExternalProducts(tx, input, externalProducts)

  const pending: PendingStockLine[] = []
  const eventItems: Array<Record<string, unknown>> = []
  const ordered = [...stock].sort((a, b) => (a.line.productId ?? "").localeCompare(b.line.productId ?? "") || a.line.jobIndex - b.line.jobIndex || a.line.partIndex - b.line.partIndex)
  for (const { line, allocationId } of ordered) {
    const description = input.jobs[line.jobIndex]!.parts[line.partIndex]!.description
    let result: Awaited<ReturnType<typeof consumePartTx>>
    try {
      result = await consumePartTx(tx, {
        recordId: input.id,
        workOrderId: context.workOrderId as string,
        recordWorksiteId: context.recordWorksiteId,
        productId: line.productId as string,
        allocationId,
        quantity: line.quantity,
        actorUserId: context.actorUserId,
        userEmail: context.userEmail,
      })
    } catch (error) {
      if (error instanceof PartsValidationError) throw new PartRejection(error.message, partField(line.jobIndex, line.partIndex, error.field ?? "productId"))
      throw error
    }
    line.quantity = roundQty(line.quantity)
    line.allocationId = result.allocationId
    if (result.status === "descontado") {
      line.stockStatus = "descontado"
      line.inventoryMovementId = result.movementId
    } else {
      line.stockStatus = "pendiente_conciliar"
      line.stockNote = result.note
      pending.push({ recordPartId: line.id, productId: line.productId as string, worksiteId: result.worksiteId })
    }
    eventItems.push({
      recordPartId: line.id,
      productId: line.productId,
      description,
      quantity: line.quantity,
      status: line.stockStatus,
      allocationId: line.allocationId,
      worksiteId: result.worksiteId,
      ...(result.status === "descontado" ? { movementId: result.movementId } : { note: result.note }),
    })
  }
  return { lines, pending, eventItems }
}

/** Un repuesto externo puede nombrar su producto del catálogo: si lo nombra, existe y es repuesto (sin esto la FK da un 500). */
async function checkExternalProducts(tx: Tx, input: SyncCorrectiveRecord, ids: ReadonlySet<string>): Promise<void> {
  if (ids.size === 0) return
  const rows = await tx.select({ id: products.id, isSparePart: products.isSparePart }).from(products).where(inArray(products.id, [...ids]))
  const valid = new Set(rows.filter((row) => row.isSparePart).map((row) => row.id))
  for (const [jobIndex, job] of input.jobs.entries()) {
    for (const [partIndex, part] of job.parts.entries()) {
      if (part.source === "externo" && part.productId && !valid.has(part.productId)) {
        throw new PartRejection(NOT_A_SPARE_PART, partField(jobIndex, partIndex, "productId"))
      }
    }
  }
}
