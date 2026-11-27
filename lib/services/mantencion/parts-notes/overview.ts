import { and, asc, desc, eq, gte, inArray, ne, notInArray, or } from "drizzle-orm"
import { db } from "@/db"
import { fuelVehicles, mantPartsNoteItems, mantPartsNotes, mantRecordParts, mantRecords, mantWorkOrders, worksites } from "@/db/schema"
import { PARTS_NOTE_CLOSED_STATUSES, type CatalogPartsAvailable, type CatalogPartsNote, type PartsNoteStatus } from "@/lib/mantencion/contracts"
import type { MantViewer } from "../access"
import { listAvailableForWorkOrders } from "../parts/reads"
import type { RecordPartSource, RecordPartStockStatus, WorkOrderPartsOverview } from "../parts/types"
import { canSeeWorkOrder, workOrderVisibility } from "../work-orders/access"
import { isImportedClosedNote, loadLineStates } from "./lines"

/**
 * Notas de pedido (NP) y repuestos de una o varias OT, en la forma que comparten la
 * sección «Repuestos» de la OT (web) y el catálogo del teléfono. Pocas consultas para
 * TODAS las OT que se piden (nunca una por OT ni por línea).
 */

const iso = (value: string) => new Date(value).toISOString()

/** Lo que hace falta de una NP para armar su entrada del catálogo: sus líneas se leen aparte, todas juntas. */
interface NoteHead {
  id: string
  code: string
  status: string
  /** Folio de CHOME ERP si la nota se importó (ver `isImportedClosedNote`). */
  externalRef?: string | null
  workOrderId: string | null
  equipmentStopped: boolean
  createdAt: string
}

/** Cada NP con su entrada de catálogo (líneas con etapa, llegado y usado), en pocas consultas para todas a la vez. */
async function withLines<T extends NoteHead>(notes: readonly T[]): Promise<Array<{ note: T; entry: CatalogPartsNote }>> {
  if (notes.length === 0) return []
  const items = await db
    .select()
    .from(mantPartsNoteItems)
    .where(inArray(mantPartsNoteItems.noteId, notes.map((note) => note.id)))
    .orderBy(asc(mantPartsNoteItems.noteId), asc(mantPartsNoteItems.sortOrder))
  const noteById = new Map(notes.map((note) => [note.id, note]))
  const states = await loadLineStates(items.map((item) => {
    const note = noteById.get(item.noteId)!
    return {
      id: item.id, noteId: item.noteId, workOrderId: note.workOrderId, productId: item.productId, resolution: item.resolution, sortOrder: item.sortOrder,
      noteCreatedAt: note.createdAt, quantity: Number(item.quantity), importedClosed: isImportedClosedNote(note),
    }
  }))

  return notes.map((note) => {
    const lines = items.filter((item) => item.noteId === note.id).map((item) => {
      const state = states.get(item.id)!
      return {
        id: item.id,
        description: item.description,
        quantity: Number(item.quantity),
        unit: item.unitOfMeasure,
        partNumber: item.partNumber,
        stage: state.stage,
        arrived: state.arrived,
        used: state.used,
        rejectionReason: item.resolution === "rechazada" ? item.resolutionReason : null,
      }
    })
    const entry: CatalogPartsNote = {
      id: note.id,
      code: note.code,
      status: note.status as PartsNoteStatus,
      equipmentStopped: note.equipmentStopped,
      createdAt: iso(note.createdAt),
      lines,
    }
    return { note, entry }
  })
}

/**
 * Las NP de las OT indicadas con sus líneas ya calculadas (etapa, llegado, usado).
 * El catálogo del teléfono excluye las anuladas; la OT web las muestra con su estado.
 */
export async function loadPartsNotesForWorkOrders(workOrderIds: readonly string[], options: { includeVoided: boolean }): Promise<Map<string, CatalogPartsNote[]>> {
  const byWorkOrder = new Map<string, CatalogPartsNote[]>()
  if (workOrderIds.length === 0) return byWorkOrder
  const notes = await db
    .select({
      id: mantPartsNotes.id,
      code: mantPartsNotes.code,
      status: mantPartsNotes.status,
      externalRef: mantPartsNotes.externalRef,
      workOrderId: mantPartsNotes.workOrderId,
      equipmentStopped: mantPartsNotes.equipmentStopped,
      createdAt: mantPartsNotes.createdAt,
    })
    .from(mantPartsNotes)
    .where(and(inArray(mantPartsNotes.workOrderId, [...workOrderIds]), options.includeVoided ? undefined : ne(mantPartsNotes.status, "anulada")))
    .orderBy(asc(mantPartsNotes.createdAt), asc(mantPartsNotes.id))

  for (const { note, entry } of await withLines(notes)) {
    // Sólo las NP con OT entran en el mapa por OT: la consulta ya filtra por ellas; el guard es para el tipo.
    if (!note.workOrderId) continue
    byWorkOrder.set(note.workOrderId, [...(byWorkOrder.get(note.workOrderId) ?? []), entry])
  }
  return byWorkOrder
}

/** Cuántas notas propias baja el catálogo como máximo: un tope de seguridad, las más nuevas primero. */
export const OWN_PARTS_NOTES_LIMIT = 150
/** Las cerradas, rechazadas y anuladas se conservan este tiempo en el teléfono («Mis notas»). */
export const OWN_PARTS_NOTES_CLOSED_DAYS = 30

/**
 * Mis notas de pedido (con y sin OT) para el catálogo del teléfono: SÓLO las que pidió `userId`
 * (`requested_by_user_id`), las abiertas y las cerradas, rechazadas o anuladas de los últimos 30 días. Cada una trae su
 * faena, su OT y equipo si los hay, la urgencia, la observación y el motivo de «En espera» o «Anulada»; sus líneas, lo
 * mismo que las de la OT (etapa, llegado, usado y motivo del rechazo).
 */
export async function loadOwnPartsNotes(userId: string, now: number = Date.now()): Promise<CatalogPartsNote[]> {
  const since = new Date(now - OWN_PARTS_NOTES_CLOSED_DAYS * 86_400_000).toISOString()
  const notes = await db
    .select({
      id: mantPartsNotes.id,
      code: mantPartsNotes.code,
      status: mantPartsNotes.status,
      externalRef: mantPartsNotes.externalRef,
      workOrderId: mantPartsNotes.workOrderId,
      equipmentStopped: mantPartsNotes.equipmentStopped,
      createdAt: mantPartsNotes.createdAt,
      updatedAt: mantPartsNotes.updatedAt,
      clientOpId: mantPartsNotes.clientOpId,
      urgent: mantPartsNotes.urgent,
      notes: mantPartsNotes.notes,
      holdReason: mantPartsNotes.holdReason,
      voidReason: mantPartsNotes.voidReason,
      worksiteId: mantPartsNotes.worksiteId,
      worksiteName: worksites.name,
      workOrderFolio: mantWorkOrders.folio,
      snapshot: mantWorkOrders.equipmentSnapshot,
    })
    .from(mantPartsNotes)
    .innerJoin(worksites, eq(worksites.id, mantPartsNotes.worksiteId))
    .leftJoin(mantWorkOrders, eq(mantWorkOrders.id, mantPartsNotes.workOrderId))
    .where(and(
      eq(mantPartsNotes.requestedByUserId, userId),
      or(notInArray(mantPartsNotes.status, [...PARTS_NOTE_CLOSED_STATUSES]), gte(mantPartsNotes.updatedAt, since)),
    ))
    .orderBy(desc(mantPartsNotes.createdAt), desc(mantPartsNotes.id))
    .limit(OWN_PARTS_NOTES_LIMIT)

  return (await withLines(notes)).map(({ note, entry }): CatalogPartsNote => ({
    ...entry,
    clientOpId: note.clientOpId,
    urgent: note.urgent,
    notes: note.notes,
    statusReason: note.status === "en_espera" ? note.holdReason : note.status === "anulada" ? note.voidReason : null,
    worksiteId: note.worksiteId,
    worksiteName: note.worksiteName,
    workOrderId: note.workOrderId,
    workOrderFolio: note.workOrderFolio,
    equipmentCode: note.snapshot?.code ?? null,
    equipmentPlate: note.snapshot?.plate ?? null,
    updatedAt: iso(note.updatedAt),
  }))
}

/** Lo que el catálogo del teléfono agrega a cada OT: sus NP no anuladas y los repuestos reservados sin usar. */
export async function loadCatalogPartsForWorkOrders(workOrderIds: readonly string[]): Promise<{
  notes: Map<string, CatalogPartsNote[]>
  available: Map<string, CatalogPartsAvailable[]>
}> {
  const [notes, available] = await Promise.all([
    loadPartsNotesForWorkOrders(workOrderIds, { includeVoided: false }),
    listAvailableForWorkOrders(workOrderIds),
  ])
  const byWorkOrder = new Map<string, CatalogPartsAvailable[]>()
  for (const { workOrderId, ...part } of available) byWorkOrder.set(workOrderId, [...(byWorkOrder.get(workOrderId) ?? []), part])
  return { notes, available: byWorkOrder }
}

/** Líneas de registros vigentes enlazados a la OT, con lo que pasó con su stock. */
async function loadConsumptions(workOrderId: string): Promise<WorkOrderPartsOverview["consumptions"]> {
  const rows = await db
    .select({
      recordPartId: mantRecordParts.id,
      recordId: mantRecordParts.recordId,
      recordFolio: mantRecords.folio,
      productId: mantRecordParts.productId,
      description: mantRecordParts.description,
      quantity: mantRecordParts.quantity,
      source: mantRecordParts.source,
      stockStatus: mantRecordParts.stockStatus,
      stockNote: mantRecordParts.stockNote,
    })
    .from(mantRecordParts)
    .innerJoin(mantRecords, eq(mantRecords.id, mantRecordParts.recordId))
    .where(and(eq(mantRecords.workOrderId, workOrderId), eq(mantRecords.status, "vigente")))
    .orderBy(asc(mantRecords.signedAt), asc(mantRecords.id), asc(mantRecordParts.sortOrder))
  return rows.map((row) => ({
    ...row,
    quantity: Number(row.quantity),
    source: row.source as RecordPartSource,
    stockStatus: row.stockStatus as RecordPartStockStatus,
  }))
}

/**
 * La sección «Repuestos» de la OT: sus NP, lo reservado y sin usar, y lo consumido. El
 * alcance es el de la OT (`workOrderVisibility`): quien no la ve recibe todo vacío.
 */
export async function loadWorkOrderPartsOverview(viewer: MantViewer, workOrderId: string): Promise<WorkOrderPartsOverview> {
  const empty: WorkOrderPartsOverview = { notes: [], available: [], consumptions: [] }
  const [ot] = await db
    .select({
      status: mantWorkOrders.status,
      worksiteId: mantWorkOrders.worksiteId,
      requestedByUserId: mantWorkOrders.requestedByUserId,
      assignedToUserId: mantWorkOrders.assignedToUserId,
      vehicleWorksiteId: fuelVehicles.worksiteId,
    })
    .from(mantWorkOrders)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, mantWorkOrders.vehicleId))
    .where(eq(mantWorkOrders.id, workOrderId))
    .limit(1)
  if (!ot || !canSeeWorkOrder(workOrderVisibility(viewer), ot)) return empty

  const [notes, available, consumptions] = await Promise.all([
    loadPartsNotesForWorkOrders([workOrderId], { includeVoided: true }),
    listAvailableForWorkOrders([workOrderId]),
    loadConsumptions(workOrderId),
  ])
  return { notes: notes.get(workOrderId) ?? [], available, consumptions }
}
