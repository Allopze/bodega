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
import { workOrdersWhere, type WorkOrderListFilters } from "./query"

/**
 * Libro «Órdenes de trabajo»: la hoja principal (una fila por OT), «Ítems» e
 * «Historial», con fechas reales de Excel, la fila 1 fija y la hoja de
 * metadatos que pone `buildXlsxBuffer`. Respeta el alcance del usuario igual
 * que la lista, y deja una fila en la bitácora por cada exportación.
 */

export const WORK_ORDERS_EXPORT_LIMIT = 5000

export type WorkOrderExportOutcome =
  | { ok: true; data: { base64: string; filename: string; truncated: boolean; rowLimit: number } }
  | { ok: false; message: string }

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
  received: "Recepción",
  rejected: "Devuelta a taller",
  conformed: "Recepción en faena (conformidad)",
  voided: "Anulada",
  reopened: "Reabierta",
  record_linked: "Registro enlazado",
}

export async function exportWorkOrders(input: {
  session: Session
  filters: Omit<WorkOrderListFilters, "page" | "pageSize">
}): Promise<WorkOrderExportOutcome> {
  const viewer = viewerFromSession(input.session)
  const where = workOrdersWhere(viewer, input.filters)

  const requester = alias(users, "requester")
  const assignee = alias(users, "assignee")
  const rows = await db
    .select({ ot: mantWorkOrders, worksiteName: worksites.name, requestedByName: requester.name, assignedToName: assignee.name })
    .from(mantWorkOrders)
    .innerJoin(worksites, eq(worksites.id, mantWorkOrders.worksiteId))
    .innerJoin(requester, eq(requester.id, mantWorkOrders.requestedByUserId))
    .leftJoin(assignee, eq(assignee.id, mantWorkOrders.assignedToUserId))
    .where(where)
    .orderBy(desc(mantWorkOrders.createdAt), asc(mantWorkOrders.id))
    .limit(WORK_ORDERS_EXPORT_LIMIT + 1)

  const truncated = rows.length > WORK_ORDERS_EXPORT_LIMIT
  const kept = truncated ? rows.slice(0, WORK_ORDERS_EXPORT_LIMIT) : rows
  if (kept.length === 0) return { ok: false, message: "No hay órdenes de trabajo para exportar con estos filtros." }
  const ids = kept.map((row) => row.ot.id)

  const [items, events] = await Promise.all([
    db.select().from(mantWorkOrderItems).where(inArray(mantWorkOrderItems.workOrderId, ids))
      .orderBy(asc(mantWorkOrderItems.workOrderId), asc(mantWorkOrderItems.kind), asc(mantWorkOrderItems.sortOrder)),
    db.select({ event: mantWorkOrderEvents, actorName: users.name })
      .from(mantWorkOrderEvents)
      .innerJoin(users, eq(users.id, mantWorkOrderEvents.actorUserId))
      .where(inArray(mantWorkOrderEvents.workOrderId, ids))
      .orderBy(asc(mantWorkOrderEvents.workOrderId), asc(mantWorkOrderEvents.createdAt)),
  ])

  const meta = new Map(kept.map((row) => [row.ot.id, {
    folio: row.ot.folio, worksite: row.worksiteName, code: row.ot.equipmentSnapshot.code, plate: row.ot.equipmentSnapshot.plate,
  }]))
  const lead = (workOrderId: string): ReportCell[] => {
    const m = meta.get(workOrderId)!
    return [m.folio, m.worksite, m.code, m.plate]
  }
  const leadHeaders = ["Folio", "Faena", "Equipo", "Patente"]

  const otRows: ReportCell[][] = kept.map(({ ot, worksiteName, requestedByName, assignedToName }) => [
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
  ])
  const otHeaders = [
    "Folio", "Estado", "Faena", "Equipo", "Patente", "Tipo de equipo", "Reparación", "Mantención", "Fecha OT", "Solicitante", "Creada por",
    "Mecánico", "Reparación solicitada", "Observaciones", "Taller", "Nombre del taller", "Encargado del taller", "Operador",
    "Ingreso a taller", "Lectura de ingreso", "Unidad", "Fec. estimada entrega", "Salida taller", "Recepción", "Recibió", "Recepción en faena",
    "Recibió en faena", "Cerrada", "Veces devuelta", "Motivo de anulación", "Creada",
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
    columnFormats: { 8: EXCEL_DATE_FORMAT, 18: EXCEL_DATETIME_FORMAT, 19: "#,##0.0", 21: EXCEL_DATE_FORMAT, 22: EXCEL_DATETIME_FORMAT, 23: EXCEL_DATETIME_FORMAT, 25: EXCEL_DATETIME_FORMAT, 27: EXCEL_DATETIME_FORMAT, 30: EXCEL_DATETIME_FORMAT },
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
