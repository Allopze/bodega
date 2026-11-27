import { and, asc, eq, inArray, ne } from "drizzle-orm"
import { db } from "@/db"
import { fuelVehicles, mantPartsNoteItems, mantPartsNotes, mantRecordParts, mantRecords, mantWorkOrders } from "@/db/schema"
import type { CatalogPartsAvailable, CatalogPartsNote, PartsNoteStatus } from "@/lib/mantencion/contracts"
import type { MantViewer } from "../access"
import { listAvailableForWorkOrders } from "../parts/reads"
import type { RecordPartSource, RecordPartStockStatus, WorkOrderPartsOverview } from "../parts/types"
import { canSeeWorkOrder, workOrderVisibility } from "../work-orders/access"
import { loadLineStates } from "./lines"

/**
 * Notas de pedido (NP) y repuestos de una o varias OT, en la forma que comparten la
 * sección «Repuestos» de la OT (web) y el catálogo del teléfono. Pocas consultas para
 * TODAS las OT que se piden (nunca una por OT ni por línea).
 */

const iso = (value: string) => new Date(value).toISOString()

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
      workOrderId: mantPartsNotes.workOrderId,
      equipmentStopped: mantPartsNotes.equipmentStopped,
      createdAt: mantPartsNotes.createdAt,
    })
    .from(mantPartsNotes)
    .where(and(inArray(mantPartsNotes.workOrderId, [...workOrderIds]), options.includeVoided ? undefined : ne(mantPartsNotes.status, "anulada")))
    .orderBy(asc(mantPartsNotes.createdAt), asc(mantPartsNotes.id))
  if (notes.length === 0) return byWorkOrder

  const items = await db
    .select()
    .from(mantPartsNoteItems)
    .where(inArray(mantPartsNoteItems.noteId, notes.map((note) => note.id)))
    .orderBy(asc(mantPartsNoteItems.noteId), asc(mantPartsNoteItems.sortOrder))
  const noteById = new Map(notes.map((note) => [note.id, note]))
  const states = await loadLineStates(items.map((item) => {
    const note = noteById.get(item.noteId)!
    return { id: item.id, noteId: item.noteId, workOrderId: note.workOrderId, productId: item.productId, resolution: item.resolution, sortOrder: item.sortOrder, noteCreatedAt: note.createdAt }
  }))

  for (const note of notes) {
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
    // Sólo las NP con OT entran en el mapa por OT: la consulta ya filtra por ellas; el guard es para el tipo.
    if (!note.workOrderId) continue
    byWorkOrder.set(note.workOrderId, [...(byWorkOrder.get(note.workOrderId) ?? []), entry])
  }
  return byWorkOrder
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
