import { and, eq, inArray, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  mantPartsAllocations, mantPartsNoteItems, mantPartsNotes, mantRecordParts, mantRecords, products,
} from "@/db/schema"

/**
 * Hoja «Repuestos» de la exportación de OT (ADR mantención 0001): por orden de trabajo y repuesto,
 * lo pedido en las notas de pedido, lo reservado en la bodega de la faena, lo usado en los
 * registros y lo que quedó pendiente de conciliar. El alcance lo pone quien llama: sólo se leen las
 * OT que ya pasaron por el filtro de faenas de la lista.
 *
 * Una fila por (OT, producto). Las líneas de una NP sin producto de catálogo (texto libre) no se
 * pueden juntar con nada y van cada una en su fila.
 */

export type WorkOrderPartsRow = {
  workOrderId: string
  noteCodes: string[]
  name: string
  partNumber: string
  /** `Pendiente`, `Desde stock`, `En compra` o `Rechazada` (varias, separadas por coma, si hay más de una línea). */
  noteStatus: string
  requested: number
  reserved: number
  used: number
  released: number
  pendingConciliation: number
}

const RESOLUTION_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  desde_stock: "Desde stock",
  en_compra: "En compra",
  rechazada: "Rechazada",
}

/** Las cantidades son numeric(10,2): se suman en centésimas para no arrastrar deriva de punto flotante. */
const addQty = (current: number, delta: number) => Math.round((current + delta) * 100) / 100

export async function loadWorkOrderPartsRows(workOrderIds: readonly string[]): Promise<WorkOrderPartsRow[]> {
  if (workOrderIds.length === 0) return []
  const ids = [...workOrderIds]

  const [noteLines, allocations, recordLines] = await Promise.all([
    // Pedido: las líneas de las NP vigentes de la OT. Una NP anulada ya no pide nada.
    db.select({
      workOrderId: mantPartsNotes.workOrderId,
      noteCode: mantPartsNotes.code,
      itemId: mantPartsNoteItems.id,
      productId: mantPartsNoteItems.productId,
      productName: products.name,
      productPartNumber: products.partNumber,
      description: mantPartsNoteItems.description,
      partNumber: mantPartsNoteItems.partNumber,
      quantity: mantPartsNoteItems.quantity,
      resolution: mantPartsNoteItems.resolution,
    })
      .from(mantPartsNoteItems)
      .innerJoin(mantPartsNotes, eq(mantPartsNotes.id, mantPartsNoteItems.noteId))
      .leftJoin(products, eq(products.id, mantPartsNoteItems.productId))
      .where(and(inArray(mantPartsNotes.workOrderId, ids), ne(mantPartsNotes.status, "anulada"))),
    // Reservado y liberado: todas las reservas de la OT, activas o liberadas.
    db.select({
      workOrderId: mantPartsAllocations.workOrderId,
      productId: mantPartsAllocations.productId,
      productName: products.name,
      productPartNumber: products.partNumber,
      quantity: mantPartsAllocations.quantity,
      releasedQuantity: mantPartsAllocations.releasedQuantity,
    })
      .from(mantPartsAllocations)
      .innerJoin(products, eq(products.id, mantPartsAllocations.productId))
      .where(inArray(mantPartsAllocations.workOrderId, ids)),
    // Usado y pendiente de conciliar: líneas de registro que salieron (o debían salir) de la bodega de la faena.
    db.select({
      workOrderId: mantRecords.workOrderId,
      productId: mantRecordParts.productId,
      productName: products.name,
      productPartNumber: products.partNumber,
      stockStatus: mantRecordParts.stockStatus,
      quantity: sql<number>`sum(${mantRecordParts.quantity})`.mapWith(Number),
    })
      .from(mantRecordParts)
      .innerJoin(mantRecords, eq(mantRecords.id, mantRecordParts.recordId))
      .innerJoin(products, eq(products.id, mantRecordParts.productId))
      .where(and(
        inArray(mantRecords.workOrderId, ids),
        eq(mantRecordParts.source, "stock"),
        inArray(mantRecordParts.stockStatus, ["descontado", "pendiente_conciliar"]),
      ))
      .groupBy(mantRecords.workOrderId, mantRecordParts.productId, products.name, products.partNumber, mantRecordParts.stockStatus),
  ])

  const rows = new Map<string, WorkOrderPartsRow & { statuses: Set<string> }>()
  const rowFor = (workOrderId: string, key: string, name: string, partNumber: string | null) => {
    const mapKey = `${workOrderId}\u0000${key}`
    let row = rows.get(mapKey)
    if (!row) {
      row = {
        workOrderId, noteCodes: [], name, partNumber: partNumber ?? "", noteStatus: "", statuses: new Set(),
        requested: 0, reserved: 0, used: 0, released: 0, pendingConciliation: 0,
      }
      rows.set(mapKey, row)
    }
    return row
  }

  for (const line of noteLines) {
    // El reporte es por OT: una nota sin OT no tiene fila aquí (su historia vive en la bandeja de notas).
    if (!line.workOrderId) continue
    const row = line.productId
      ? rowFor(line.workOrderId, line.productId, line.productName ?? line.description, line.productPartNumber ?? line.partNumber)
      : rowFor(line.workOrderId, `nota:${line.itemId}`, line.description, line.partNumber)
    if (!row.noteCodes.includes(line.noteCode)) row.noteCodes.push(line.noteCode)
    row.statuses.add(RESOLUTION_LABELS[line.resolution] ?? line.resolution)
    row.requested = addQty(row.requested, Number(line.quantity))
  }
  for (const allocation of allocations) {
    const row = rowFor(allocation.workOrderId, allocation.productId, allocation.productName, allocation.productPartNumber)
    row.reserved = addQty(row.reserved, Number(allocation.quantity))
    row.released = addQty(row.released, Number(allocation.releasedQuantity))
  }
  for (const line of recordLines) {
    if (!line.workOrderId || !line.productId) continue
    const row = rowFor(line.workOrderId, line.productId, line.productName, line.productPartNumber)
    if (line.stockStatus === "descontado") row.used = addQty(row.used, line.quantity)
    else row.pendingConciliation = addQty(row.pendingConciliation, line.quantity)
  }

  return [...rows.values()]
    .map(({ statuses, ...row }) => ({ ...row, noteCodes: row.noteCodes.sort(), noteStatus: [...statuses].join(", ") }))
    .sort((a, b) => a.workOrderId.localeCompare(b.workOrderId) || a.name.localeCompare(b.name, "es"))
}
