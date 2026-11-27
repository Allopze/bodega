import { and, asc, desc, eq, inArray } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import type { Session } from "next-auth"
import { db } from "@/db"
import {
  costCenters, fuelVehicles, mantPartsNoteItems, mantPartsNotes, mantWorkOrders, products, purchaseOrders, suppliers, users, worksites,
} from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { PARTS_NOTE_STATUSES } from "@/lib/mantencion/contracts"
import { EXCEL_DATETIME_FORMAT, excelDateTime } from "@/lib/reports/excel-dates"
import { buildXlsxBuffer } from "@/lib/reports/export-module/excel-builder"
import type { ReportCell, ReportData, ReportSheet } from "@/lib/reports/export-module/types"
import { todayInChile } from "@/lib/utils"
import { NOTE_STATUS_TEXT } from "@/components/mantencion/jefatura/notas-pedido/parts-notes-format"
import { viewerFromSession } from "../access"
import type { NoteItemResolution, PartsNoteEvent, PartsNoteFilterSet, PartsNoteStatus, PartsNoteTab } from "../parts/types"
import { NP_PERMISSIONS } from "./access"
import { loadEventsByNote, statusSinceSql } from "./history"
import { isImportedClosedNote, loadLineStates } from "./lines"
import { noteFilterConditions, statusCondition, TAB_CONDITIONS } from "./list-filters"

/**
 * Libro «Notas de pedido» (R16): lo que muestra la bandeja, con sus mismos filtros, a razón de UNA FILA POR LÍNEA con la
 * cabecera de su nota, la compra que la atiende (solicitud, OC y proveedor de la OC) y la fecha en que la nota llegó a
 * cada estado; más una hoja «Historial» con cada evento. Mismas reglas de alcance que la bandeja (`noteVisibility`) y,
 * además, el permiso `mant:np:export`: sin él NO se genera nada y se contesta con un rechazo explícito.
 */

export const PARTS_NOTES_EXPORT_LIMIT = 2000

export type PartsNotesExportFilters = PartsNoteFilterSet & {
  /** Sin pestaña: todas las notas que cumplan el resto de los filtros. */
  tab?: PartsNoteTab
}

export type PartsNotesExportOutcome =
  | { ok: true; buffer: ArrayBuffer; filename: string; truncated: boolean; rowLimit: number; noteCount: number }
  | { ok: false; reason: "forbidden"; message: string }

const RESOLUTION_TEXT: Record<NoteItemResolution, string> = {
  pendiente: "Pendiente",
  desde_stock: "Desde stock",
  en_compra: "En compra",
  rechazada: "Rechazada",
}

const EVENT_KIND_TEXT: Record<PartsNoteEvent["kind"], string> = {
  creada: "Creada",
  transicion: "Cambio de estado",
  migrada: "Estado inicial (nota anterior al historial)",
}

const statusText = (status: PartsNoteStatus | null) => (status ? NOTE_STATUS_TEXT[status] : "")
const yesNo = (value: boolean) => (value ? "Sí" : "No")
const unique = (values: Array<string | null | undefined>) => [...new Set(values.filter((value): value is string => !!value))]

/** Primera vez que la nota llegó a cada estado: la fecha de la columna «Enviada el», «Aceptada el»… */
function reachedAt(events: readonly PartsNoteEvent[]): Map<PartsNoteStatus, string> {
  const reached = new Map<PartsNoteStatus, string>()
  for (const event of events) if (!reached.has(event.toStatus)) reached.set(event.toStatus, event.createdAt)
  return reached
}

export async function exportPartsNotes(input: { session: Session; filters: PartsNotesExportFilters }): Promise<PartsNotesExportOutcome> {
  const viewer = viewerFromSession(input.session)
  if (!viewer.permissions.includes(NP_PERMISSIONS.export)) {
    return { ok: false, reason: "forbidden", message: "No tienes permiso para exportar notas de pedido." }
  }

  const { tab, status, ...rest } = input.filters
  const where = and(
    ...noteFilterConditions(viewer, rest),
    tab ? TAB_CONDITIONS[tab] : undefined,
    status ? statusCondition(status) : undefined,
  )
  const requestedBy = alias(users, "np_export_requested_by")
  const noteRows = await db
    .select({
      id: mantPartsNotes.id,
      code: mantPartsNotes.code,
      externalRef: mantPartsNotes.externalRef,
      workOrderId: mantPartsNotes.workOrderId,
      status: mantPartsNotes.status,
      statusSince: statusSinceSql,
      holdReason: mantPartsNotes.holdReason,
      voidReason: mantPartsNotes.voidReason,
      worksiteName: worksites.name,
      requestedByName: requestedBy.name,
      importedByName: mantPartsNotes.requestedByName,
      workOrderFolio: mantWorkOrders.folio,
      equipmentCode: fuelVehicles.code,
      urgent: mantPartsNotes.urgent,
      equipmentStopped: mantPartsNotes.equipmentStopped,
      notes: mantPartsNotes.notes,
      createdAt: mantPartsNotes.createdAt,
    })
    .from(mantPartsNotes)
    .leftJoin(mantWorkOrders, eq(mantWorkOrders.id, mantPartsNotes.workOrderId))
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, mantPartsNotes.vehicleId))
    .innerJoin(worksites, eq(worksites.id, mantPartsNotes.worksiteId))
    .leftJoin(requestedBy, eq(requestedBy.id, mantPartsNotes.requestedByUserId))
    .where(where)
    .orderBy(desc(mantPartsNotes.createdAt), asc(mantPartsNotes.id))
    .limit(PARTS_NOTES_EXPORT_LIMIT + 1)

  const truncated = noteRows.length > PARTS_NOTES_EXPORT_LIMIT
  const kept = truncated ? noteRows.slice(0, PARTS_NOTES_EXPORT_LIMIT) : noteRows
  // Sin notas el libro sale igual, con sus encabezados y la hoja de metadatos («Filas incluidas: 0»): la descarga es un enlace y no
  // puede mostrar un mensaje, así que un archivo vacío dice más que una descarga fallida.
  const noteIds = kept.map((row) => row.id)

  const chargeVehicle = alias(fuelVehicles, "np_export_charge_vehicle")
  const itemRows = await db
    .select({
      id: mantPartsNoteItems.id,
      noteId: mantPartsNoteItems.noteId,
      description: mantPartsNoteItems.description,
      partNumber: mantPartsNoteItems.partNumber,
      productId: mantPartsNoteItems.productId,
      productName: products.name,
      quantity: mantPartsNoteItems.quantity,
      unit: mantPartsNoteItems.unitOfMeasure,
      resolution: mantPartsNoteItems.resolution,
      resolutionReason: mantPartsNoteItems.resolutionReason,
      chargeVehicleCode: chargeVehicle.code,
      chargeCostCenterName: costCenters.name,
      chargeText: mantPartsNoteItems.chargeText,
      suggestedSupplierName: suppliers.name,
      supplierHint: mantPartsNoteItems.supplierHint,
      sortOrder: mantPartsNoteItems.sortOrder,
    })
    .from(mantPartsNoteItems)
    .leftJoin(products, eq(products.id, mantPartsNoteItems.productId))
    .leftJoin(chargeVehicle, eq(chargeVehicle.id, mantPartsNoteItems.chargeVehicleId))
    .leftJoin(costCenters, eq(costCenters.id, mantPartsNoteItems.chargeCostCenterId))
    .leftJoin(suppliers, eq(suppliers.id, mantPartsNoteItems.suggestedSupplierId))
    .where(inArray(mantPartsNoteItems.noteId, noteIds))
    .orderBy(asc(mantPartsNoteItems.noteId), asc(mantPartsNoteItems.sortOrder))

  const noteById = new Map(kept.map((row) => [row.id, row]))
  const [states, eventsByNote] = await Promise.all([
    loadLineStates(itemRows.map((item) => {
      const note = noteById.get(item.noteId)!
      return {
        id: item.id, noteId: item.noteId, workOrderId: note.workOrderId, productId: item.productId, resolution: item.resolution, sortOrder: item.sortOrder,
        noteCreatedAt: note.createdAt, quantity: Number(item.quantity), importedClosed: isImportedClosedNote(note),
      }
    })),
    loadEventsByNote(noteIds),
  ])
  // El proveedor de la OC que atiende cada compra: una sola lectura de las OC citadas.
  const orderIds = unique([...states.values()].flatMap((state) => state.purchases.map((purchase) => purchase.orderId)))
  const orderSuppliers = new Map<string, string>()
  if (orderIds.length > 0) {
    const rows = await db
      .select({ id: purchaseOrders.id, supplierName: suppliers.name })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(inArray(purchaseOrders.id, orderIds))
    for (const row of rows) orderSuppliers.set(row.id, row.supplierName)
  }

  const lineRows: ReportCell[][] = itemRows.map((item) => {
    const note = noteById.get(item.noteId)!
    const state = states.get(item.id)!
    const reached = reachedAt(eventsByNote.get(note.id) ?? [])
    const charge = item.chargeVehicleCode ?? item.chargeCostCenterName ?? item.chargeText ?? ""
    return [
      note.code,
      note.externalRef ?? "",
      note.worksiteName,
      note.requestedByName ?? note.importedByName ?? "",
      note.workOrderFolio ?? "Sin OT",
      note.equipmentCode ?? "",
      yesNo(note.urgent),
      yesNo(note.equipmentStopped),
      note.notes ?? "",
      statusText(note.status as PartsNoteStatus),
      excelDateTime(note.statusSince),
      excelDateTime(note.createdAt),
      item.description,
      item.partNumber ?? "",
      item.productName ?? "",
      item.quantity,
      item.unit,
      charge,
      item.suggestedSupplierName ?? item.supplierHint ?? "",
      RESOLUTION_TEXT[item.resolution as NoteItemResolution],
      item.resolutionReason ?? "",
      state.arrived,
      state.purchases.map((purchase) => purchase.requestCode).join(", "),
      unique(state.purchases.map((purchase) => purchase.orderCode)).join(", "),
      unique(state.purchases.map((purchase) => (purchase.orderId ? orderSuppliers.get(purchase.orderId) : null))).join(", "),
      note.holdReason ?? "",
      note.voidReason ?? "",
      ...PARTS_NOTE_STATUSES.map((reachedStatus) => excelDateTime(reached.get(reachedStatus))),
    ]
  })

  const dateColumns = [10, 11, ...PARTS_NOTE_STATUSES.map((_, index) => 27 + index)]
  const headers = [
    "Nota", "Referencia externa", "Faena", "Solicitante", "OT", "Equipo de la nota", "Urgente", "Equipo detenido", "Observación", "Estado actual", "En este estado desde", "Creada",
    "Descripción", "N° de parte", "Artículo del catálogo", "Cantidad", "Unidad", "Cargo", "Proveedor sugerido", "Resolución", "Motivo de la resolución", "Llegó a la faena",
    "Solicitud de compra", "OC", "Proveedor de la OC", "Motivo de la espera", "Motivo de la anulación",
    ...PARTS_NOTE_STATUSES.map((reachedStatus) => `${statusText(reachedStatus)} el`),
  ]
  const history: ReportSheet = {
    worksheetName: "Historial",
    headers: ["Nota", "Faena", "Fecha", "Evento", "Estado anterior", "Estado nuevo", "Motivo", "Quién", "Línea"],
    rows: kept.flatMap((note) => (eventsByNote.get(note.id) ?? []).map((event): ReportCell[] => [
      note.code,
      note.worksiteName,
      excelDateTime(event.createdAt),
      EVENT_KIND_TEXT[event.kind],
      statusText(event.fromStatus),
      statusText(event.toStatus),
      event.reason ?? "",
      event.actorName ?? "Automático",
      event.itemDescription ?? "",
    ])),
    columnFormats: { 2: EXCEL_DATETIME_FORMAT },
  }
  const report: ReportData = {
    filenameBase: "notas-de-pedido",
    worksheetName: "Notas de pedido",
    headers,
    rows: lineRows,
    columnFormats: { ...Object.fromEntries(dateColumns.map((column) => [column, EXCEL_DATETIME_FORMAT])), 15: "#,##0.00", 21: "#,##0.00" },
    sheets: [history],
    rowLimitApplied: truncated,
  }
  const buffer = await buildXlsxBuffer(report, {
    session: input.session,
    filters: { ...input.filters },
    from: input.filters.from ?? null,
    to: input.filters.to ?? null,
    rowLimit: PARTS_NOTES_EXPORT_LIMIT,
  })

  await recordAudit({
    userId: input.session.user.id,
    userEmail: input.session.user.email ?? undefined,
    action: "export",
    entityType: "mant_parts_notes_export",
    entityId: nanoid(),
    newState: { noteCount: kept.length, lineCount: lineRows.length, truncated, filters: { ...input.filters } },
  })

  return { ok: true, buffer, filename: `notas-de-pedido-${todayInChile()}.xlsx`, truncated, rowLimit: PARTS_NOTES_EXPORT_LIMIT, noteCount: kept.length }
}

