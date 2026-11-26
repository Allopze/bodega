import { asc, desc, eq, inArray } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import type { Session } from "next-auth"
import { db } from "@/db"
import { mantWorkOrderEvents, mantWorkOrderItems, mantWorkOrders, users, worksites } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import {
  OT_ITEM_KIND_LABELS, OT_STATUS_LABELS, type OtEventType, type OtItemKind, type OtStatus,
} from "@/lib/mantencion/work-order-states"
import { EXCEL_DATE_FORMAT, EXCEL_DATETIME_FORMAT, excelDateTime, excelPlainDate } from "@/lib/reports/excel-dates"
import { buildXlsxBuffer } from "@/lib/reports/export-module/excel-builder"
import type { ReportCell, ReportData, ReportSheet } from "@/lib/reports/export-module/types"
import { todayInChile } from "@/lib/utils"
import { viewerFromSession } from "../access"
import { ACTION_TYPE_LABELS, SPECIALTY_LABELS, workOrderActionType } from "@/lib/mantencion/action-type"
import { daysStopped, specialtiesOf, workOrdersWhere, type WorkOrderListFilters } from "./query"
import { loadWorkOrderPartsRows } from "./export-parts"

/**
 * Libro «Órdenes de trabajo»: la hoja principal (una fila por OT), «Ítems»,
 * «Repuestos» (notas de pedido, reservas y consumo) e «Historial», con fechas
 * reales de Excel, la fila 1 fija y la hoja de metadatos que pone
 * `buildXlsxBuffer`. Respeta el alcance del usuario igual que la lista, y deja
 * una fila en la bitácora por cada exportación.
 */

export const WORK_ORDERS_EXPORT_LIMIT = 5000

export type WorkOrderExportOutcome =
  | { ok: true; data: { base64: string; filename: string; truncated: boolean; rowLimit: number } }
  | { ok: false; message: string }

/** En el libro, «No informado» (no «Sin clasificar») cuando no se puede saber: así lo pide Trinorma para las OT anteriores. */
const ACTION_TYPE_LABELS_EXPORT = { ...ACTION_TYPE_LABELS, sin_clasificar: "No informado" } as const
const yesNo = (value: boolean) => (value ? "Sí" : "No")
const EVENT_LABELS: Record<OtEventType, string> = {
  created: "Creada",
  edited: "Solicitud editada",
  assigned: "Asignada",
  unassigned: "Desasignada",
  taken: "Tomada por el mecánico",
  started: "Ingreso a taller",
  entry_updated: "Ingreso corregido",
  estimate_changed: "Fecha estimada cambiada",
  item_added: "Ítem agregado",
  items_marked: "Ítems marcados",
  finished: "Salida de taller",
  received: "Equipo recibido",
  rejected: "Devuelta a taller",
  conformed: "Conformidad en faena",
  voided: "Anulada",
  reopened: "Reabierta",
  record_linked: "Registro enlazado",
  parts_note_created: "Nota de pedido enviada",
  parts_note_resolved: "Nota de pedido resuelta",
  parts_allocated: "Repuestos reservados",
  parts_consumed: "Repuestos usados",
  parts_released: "Reserva liberada",
}

export async function exportWorkOrders(input: {
  session: Session
  filters: Omit<WorkOrderListFilters, "page" | "pageSize">
}): Promise<WorkOrderExportOutcome> {
  const viewer = viewerFromSession(input.session)
  const where = workOrdersWhere(viewer, input.filters)

  const requester = alias(users, "requester")
  const assignee = alias(users, "assignee")
  const executionWorksite = alias(worksites, "execution_worksite")
  const rows = await db
    .select({ ot: mantWorkOrders, worksiteName: worksites.name, requestedByName: requester.name, assignedToName: assignee.name, executionWorksiteName: executionWorksite.name })
    .from(mantWorkOrders)
    .innerJoin(worksites, eq(worksites.id, mantWorkOrders.worksiteId))
    .innerJoin(requester, eq(requester.id, mantWorkOrders.requestedByUserId))
    .leftJoin(assignee, eq(assignee.id, mantWorkOrders.assignedToUserId))
    .leftJoin(executionWorksite, eq(executionWorksite.id, mantWorkOrders.executionWorksiteId))
    .where(where)
    .orderBy(desc(mantWorkOrders.createdAt), asc(mantWorkOrders.id))
    .limit(WORK_ORDERS_EXPORT_LIMIT + 1)

  const truncated = rows.length > WORK_ORDERS_EXPORT_LIMIT
  const kept = truncated ? rows.slice(0, WORK_ORDERS_EXPORT_LIMIT) : rows
  if (kept.length === 0) return { ok: false, message: "No hay órdenes de trabajo para exportar con estos filtros." }
  const ids = kept.map((row) => row.ot.id)

  const [items, events, partsRows] = await Promise.all([
    db.select().from(mantWorkOrderItems).where(inArray(mantWorkOrderItems.workOrderId, ids))
      .orderBy(asc(mantWorkOrderItems.workOrderId), asc(mantWorkOrderItems.kind), asc(mantWorkOrderItems.sortOrder)),
    db.select({ event: mantWorkOrderEvents, actorName: users.name })
      .from(mantWorkOrderEvents)
      .innerJoin(users, eq(users.id, mantWorkOrderEvents.actorUserId))
      .where(inArray(mantWorkOrderEvents.workOrderId, ids))
      .orderBy(asc(mantWorkOrderEvents.workOrderId), asc(mantWorkOrderEvents.createdAt)),
    loadWorkOrderPartsRows(ids),
  ])
  // Las filas de repuestos salen en el mismo orden de OT que la hoja principal.
  const otOrder = new Map(ids.map((id, index) => [id, index]))
  partsRows.sort((a, b) => (otOrder.get(a.workOrderId) ?? 0) - (otOrder.get(b.workOrderId) ?? 0) || a.name.localeCompare(b.name, "es"))

  const meta = new Map(kept.map((row) => [row.ot.id, {
    folio: row.ot.folio, worksite: row.worksiteName, code: row.ot.equipmentSnapshot.code, plate: row.ot.equipmentSnapshot.plate,
  }]))
  const lead = (workOrderId: string): ReportCell[] => {
    const m = meta.get(workOrderId)!
    return [m.folio, m.worksite, m.code, m.plate]
  }
  const leadHeaders = ["Folio", "Faena", "Equipo", "Patente"]

  const otRows: ReportCell[][] = kept.map(({ ot, worksiteName, requestedByName, assignedToName, executionWorksiteName }) => [
    ot.folio,
    OT_STATUS_LABELS[ot.status as OtStatus],
    worksiteName,
    ot.equipmentSnapshot.code,
    ot.equipmentSnapshot.plate,
    ot.equipmentSnapshot.type,
    yesNo(ot.repair),
    yesNo(ot.maintenance),
    excelPlainDate(ot.requestDate),
    ot.requesterName,
    requestedByName,
    assignedToName ?? "",
    ot.repairDescription ?? "",
    ot.observations ?? "",
    ot.workshopKind ? (ot.workshopKind === "interno" ? "Interno" : "Externo") : "",
    ot.workshopName ?? "",
    ot.workshopManagerName ?? "",
    ot.operatorName ?? "",
    excelDateTime(ot.workshopEntryAt),
    ot.equipmentSnapshot.unit === "km" ? ot.entryOdometer : ot.entryHourmeter,
    ot.equipmentSnapshot.unit,
    excelPlainDate(ot.estimatedDeliveryDate),
    excelDateTime(ot.workshopExitAt),
    excelDateTime(ot.receivedAt),
    ot.receiverName ?? "",
    excelDateTime(ot.faenaReceivedAt),
    ot.faenaReceiverName ?? "",
    excelDateTime(ot.closedAt),
    ot.rejectionCount,
    ot.voidReason ?? "",
    excelDateTime(ot.createdAt),
    // Trinorma R4: al final, para no mover las columnas que ya conocen quienes usan el libro.
    ACTION_TYPE_LABELS_EXPORT[workOrderActionType(ot)],
    specialtiesOf(ot.specialties).map((specialty) => SPECIALTY_LABELS[specialty]).join(", "),
    ot.laborHours,
    daysStopped(ot.workshopEntryAt, ot.workshopExitAt),
    executionWorksiteName ?? "",
    ot.workPerformed ?? "",
  ])
  const otHeaders = [
    "Folio", "Estado", "Faena", "Equipo", "Patente", "Tipo de equipo", "Reparación", "Mantención", "Fecha de la orden", "Solicitante", "Creada por",
    "Mecánico", "Reparación solicitada", "Observaciones", "Taller", "Nombre del taller", "Encargado del taller", "Operador",
    "Ingreso a taller", "Lectura de ingreso", "Unidad", "Entrega estimada", "Salida de taller", "Recepción del equipo", "Recibió", "Conformidad en faena",
    "Recibió en faena", "Cerrada", "Veces devuelta", "Motivo de anulación", "Creada",
    "Tipo de acción", "Especialidades", "Horas hombre", "Días detenido", "Faena de ejecución", "Trabajo realizado",
  ]

  const sheets: ReportSheet[] = [
    {
      worksheetName: "Ítems",
      headers: [...leadHeaders, "Lista", "Origen", "Descripción", "Resultado", "Nota"],
      rows: items.map((item) => [
        ...lead(item.workOrderId),
        OT_ITEM_KIND_LABELS[item.kind as OtItemKind],
        item.origin === "taller" ? "Agregado en taller" : "Solicitud",
        item.description,
        item.done === "si" ? "SÍ" : item.done === "no" ? "NO" : "Sin marcar",
        item.note ?? "",
      ]),
    },
    {
      worksheetName: "Repuestos",
      headers: [...leadHeaders, "NP", "Repuesto", "N° de parte", "Estado del pedido", "Pedido", "Reservado", "Usado", "Liberado", "Pendiente de conciliar"],
      rows: partsRows.map((row) => [
        ...lead(row.workOrderId),
        row.noteCodes.join(", "),
        row.name,
        row.partNumber,
        row.noteStatus,
        row.requested,
        row.reserved,
        row.used,
        row.released,
        row.pendingConciliation,
      ]),
      columnFormats: { 8: "#,##0.00", 9: "#,##0.00", 10: "#,##0.00", 11: "#,##0.00", 12: "#,##0.00" },
    },
    {
      worksheetName: "Historial",
      headers: [...leadHeaders, "Evento", "Estado anterior", "Estado nuevo", "Motivo", "Por", "Fecha"],
      rows: events.map(({ event, actorName }) => [
        ...lead(event.workOrderId),
        EVENT_LABELS[event.type as OtEventType] ?? event.type,
        event.fromStatus ? OT_STATUS_LABELS[event.fromStatus as OtStatus] : "",
        event.toStatus ? OT_STATUS_LABELS[event.toStatus as OtStatus] : "",
        event.reason ?? "",
        actorName,
        excelDateTime(event.createdAt),
      ]),
      columnFormats: { 9: EXCEL_DATETIME_FORMAT },
    },
  ]

  const report: ReportData = {
    filenameBase: "ordenes-de-trabajo",
    worksheetName: "Órdenes de trabajo",
    headers: otHeaders,
    rows: otRows,
    columnFormats: { 8: EXCEL_DATE_FORMAT, 18: EXCEL_DATETIME_FORMAT, 19: "#,##0.0", 21: EXCEL_DATE_FORMAT, 22: EXCEL_DATETIME_FORMAT, 23: EXCEL_DATETIME_FORMAT, 25: EXCEL_DATETIME_FORMAT, 27: EXCEL_DATETIME_FORMAT, 30: EXCEL_DATETIME_FORMAT, 33: "#,##0.00" },
    sheets,
    rowLimitApplied: truncated,
  }
  const buffer = await buildXlsxBuffer(report, {
    session: input.session,
    filters: { ...input.filters },
    from: input.filters.from ?? null,
    to: input.filters.to ?? null,
    rowLimit: WORK_ORDERS_EXPORT_LIMIT,
  })

  await recordAudit({
    userId: input.session.user.id,
    userEmail: input.session.user.email ?? undefined,
    action: "export",
    entityType: "mant_work_orders_export",
    entityId: nanoid(),
    newState: { rowCount: kept.length, truncated, filters: { ...input.filters } },
  })

  return {
    ok: true,
    data: {
      base64: Buffer.from(buffer).toString("base64"),
      filename: `ordenes-de-trabajo-${todayInChile()}.xlsx`,
      truncated,
      rowLimit: WORK_ORDERS_EXPORT_LIMIT,
    },
  }
}
