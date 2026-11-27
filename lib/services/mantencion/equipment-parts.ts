import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { mantPartsNoteItems, mantPartsNotes, mantRecordParts, mantRecords, mantWorkOrders, products } from "@/db/schema"
import type { MantRecordKind } from "@/lib/mantencion/types"
import { recordVisibility, recordVisibilitySql, type MantViewer } from "./access"
import { noteVisibility, noteVisibilitySql } from "./parts-notes/access"
import type { NoteItemResolution, PartsNoteStatus, RecordPartSource, RecordPartStockStatus } from "./parts/types"

/**
 * Repuestos de un equipo para su hoja de vida (R9 de «Notas de pedido ERP», 2026-11-27): las notas de pedido que se le
 * imputan y los repuestos que sus mantenciones declararon usar. Sólo lee.
 *
 * Quién ve qué lo decide el servidor con las mismas reglas de las pantallas de origen: las notas, con `noteVisibilitySql`
 * (`parts-notes/access.ts`); los consumos, con `recordVisibilitySql` (la hoja de vida sigue al equipo). Una persona sin
 * permiso sobre una de las dos listas recibe `null` en ella —«no puedo verla», que no es «no hay»—.
 *
 * Una línea de nota se imputa al equipo cuando su cargo (`charge_vehicle_id`) es el equipo, o cuando no tiene cargo
 * (ni equipo ni centro de costo) y la nota es del equipo (el de su OT). Con eso cada línea aparece en la ficha de UN solo
 * equipo: una línea de la nota de V cargada a otro equipo o a «Taller» no se muestra en V (se cuenta aparte).
 */

/** Tope de filas por lista: las últimas. El total dice cuántas hay. */
export const EQUIPMENT_PARTS_LIMIT = 50

export interface EquipmentNoteLine {
  id: string
  description: string
  quantity: number
  unitOfMeasure: string
  resolution: NoteItemResolution
}

export interface EquipmentNote {
  id: string
  code: string
  status: PartsNoteStatus
  createdAt: string
  urgent: boolean
  /** `null`: nota sin OT (pedido de taller, reposición, importada). */
  workOrderId: string | null
  workOrderFolio: string | null
  /** Sólo las líneas imputadas a este equipo. */
  lines: EquipmentNoteLine[]
  /** Líneas de la misma nota con otro cargo (otro equipo o un centro de costo): no se listan aquí. */
  otherChargeLines: number
}

export interface EquipmentConsumption {
  id: string
  recordId: string
  recordFolio: string | null
  recordKind: MantRecordKind
  /** Fecha del trabajo (`YYYY-MM-DD`). */
  workDate: string
  description: string
  sku: string | null
  quantity: number
  /** Unidad del producto de catálogo; `null` en texto libre. */
  unitOfMeasure: string | null
  source: RecordPartSource
  stockStatus: RecordPartStockStatus
  stockNote: string | null
}

export interface EquipmentList<T> {
  rows: T[]
  /** Cuántas hay en total; `rows` trae las últimas `EQUIPMENT_PARTS_LIMIT`. */
  total: number
}

export interface EquipmentParts {
  /** `null` = sin permiso sobre las notas de pedido. */
  notes: EquipmentList<EquipmentNote> | null
  /** `null` = sin permiso sobre los registros de mantención. */
  consumptions: EquipmentList<EquipmentConsumption> | null
}

/** La línea se imputa a `vehicleId`: cargo explícito, o sin cargo en la nota de ese equipo. */
function lineChargedSql(vehicleId: string): SQL {
  return sql`(${mantPartsNoteItems.chargeVehicleId} = ${vehicleId}
    or (${mantPartsNoteItems.chargeVehicleId} is null and ${mantPartsNoteItems.chargeCostCenterId} is null and ${mantPartsNotes.vehicleId} = ${vehicleId}))`
}

function lineChargedTo(line: { chargeVehicleId: string | null; chargeCostCenterId: string | null }, noteVehicleId: string | null, vehicleId: string): boolean {
  if (line.chargeVehicleId) return line.chargeVehicleId === vehicleId
  return line.chargeCostCenterId === null && noteVehicleId === vehicleId
}

async function loadEquipmentNotes(vehicleId: string, visibility: SQL, limit: number): Promise<EquipmentList<EquipmentNote>> {
  const where = and(
    visibility,
    sql`exists (select 1 from ${mantPartsNoteItems} where ${mantPartsNoteItems.noteId} = ${mantPartsNotes.id} and ${lineChargedSql(vehicleId)})`,
  )
  const [{ total } = { total: 0 }] = await db.select({ total: sql<number>`count(*)::int` }).from(mantPartsNotes).where(where)
  if (total === 0) return { rows: [], total: 0 }

  const notes = await db
    .select({
      id: mantPartsNotes.id,
      code: mantPartsNotes.code,
      status: mantPartsNotes.status,
      createdAt: mantPartsNotes.createdAt,
      urgent: mantPartsNotes.urgent,
      noteVehicleId: mantPartsNotes.vehicleId,
      workOrderId: mantPartsNotes.workOrderId,
      workOrderFolio: mantWorkOrders.folio,
    })
    .from(mantPartsNotes)
    .leftJoin(mantWorkOrders, eq(mantWorkOrders.id, mantPartsNotes.workOrderId))
    .where(where)
    .orderBy(desc(mantPartsNotes.createdAt), desc(mantPartsNotes.id))
    .limit(limit)

  const items = await db
    .select({
      id: mantPartsNoteItems.id,
      noteId: mantPartsNoteItems.noteId,
      description: mantPartsNoteItems.description,
      quantity: mantPartsNoteItems.quantity,
      unitOfMeasure: mantPartsNoteItems.unitOfMeasure,
      resolution: mantPartsNoteItems.resolution,
      chargeVehicleId: mantPartsNoteItems.chargeVehicleId,
      chargeCostCenterId: mantPartsNoteItems.chargeCostCenterId,
    })
    .from(mantPartsNoteItems)
    .where(inArray(mantPartsNoteItems.noteId, notes.map((note) => note.id)))
    .orderBy(asc(mantPartsNoteItems.noteId), asc(mantPartsNoteItems.sortOrder))
  const itemsByNote = Map.groupBy(items, (item) => item.noteId)

  const rows = notes.map<EquipmentNote>((note) => {
    const all = itemsByNote.get(note.id) ?? []
    const mine = all.filter((item) => lineChargedTo(item, note.noteVehicleId, vehicleId))
    return {
      id: note.id,
      code: note.code,
      status: note.status as PartsNoteStatus,
      createdAt: note.createdAt,
      urgent: note.urgent,
      workOrderId: note.workOrderId,
      workOrderFolio: note.workOrderFolio,
      lines: mine.map((item) => ({
        id: item.id,
        description: item.description,
        quantity: item.quantity,
        unitOfMeasure: item.unitOfMeasure,
        resolution: item.resolution as NoteItemResolution,
      })),
      otherChargeLines: all.length - mine.length,
    }
  })
  return { rows, total }
}

async function loadEquipmentConsumptions(vehicleId: string, visibility: SQL, limit: number): Promise<EquipmentList<EquipmentConsumption>> {
  // Sólo registros vigentes: uno anulado no consumió nada (su línea queda «revertida» en la bodega).
  const where = and(eq(mantRecords.vehicleId, vehicleId), eq(mantRecords.status, "vigente"), visibility)
  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(mantRecordParts)
    .innerJoin(mantRecords, eq(mantRecords.id, mantRecordParts.recordId))
    .where(where)
  if (total === 0) return { rows: [], total: 0 }

  const found = await db
    .select({
      id: mantRecordParts.id,
      recordId: mantRecords.id,
      recordFolio: mantRecords.folio,
      recordKind: mantRecords.kind,
      workDate: mantRecords.workDate,
      description: mantRecordParts.description,
      sku: products.sku,
      quantity: mantRecordParts.quantity,
      unitOfMeasure: products.unitOfMeasure,
      source: mantRecordParts.source,
      stockStatus: mantRecordParts.stockStatus,
      stockNote: mantRecordParts.stockNote,
    })
    .from(mantRecordParts)
    .innerJoin(mantRecords, eq(mantRecords.id, mantRecordParts.recordId))
    .leftJoin(products, eq(products.id, mantRecordParts.productId))
    .where(where)
    .orderBy(desc(mantRecords.workDate), desc(mantRecords.receivedAt), asc(mantRecords.id), asc(mantRecordParts.sortOrder), asc(mantRecordParts.id))
    .limit(limit)

  return {
    rows: found.map<EquipmentConsumption>((row) => ({
      ...row,
      recordKind: row.recordKind as MantRecordKind,
      source: row.source as RecordPartSource,
      stockStatus: row.stockStatus as RecordPartStockStatus,
    })),
    total,
  }
}

/**
 * Notas de pedido y consumos de repuestos del equipo, dentro del alcance de `viewer`. NO comprueba que el equipo sea
 * visible para quien mira: la ficha lo resuelve antes (`loadFleet` con el alcance de equipos).
 */
export async function loadEquipmentParts(vehicleId: string, viewer: MantViewer, opts: { limit?: number } = {}): Promise<EquipmentParts> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? EQUIPMENT_PARTS_LIMIT) || EQUIPMENT_PARTS_LIMIT, 1), 200)
  const notesVisibility = noteVisibility(viewer)
  const recordsVisibility = recordVisibility(viewer)
  // `recordVisibility` nunca dice «ninguno»: sin permiso de lectura queda un alcance sin faenas ni dueño.
  const canReadRecords = recordsVisibility.kind === "all" || recordsVisibility.worksiteIds.length > 0 || recordsVisibility.ownUserId !== null
  const [notes, consumptions] = await Promise.all([
    notesVisibility.kind === "none" ? Promise.resolve(null) : loadEquipmentNotes(vehicleId, noteVisibilitySql(notesVisibility), limit),
    canReadRecords ? loadEquipmentConsumptions(vehicleId, recordVisibilitySql(recordsVisibility), limit) : Promise.resolve(null),
  ])
  return { notes, consumptions }
}
