import { asc, inArray } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import { mantRecordItems, mantRecordParts } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { canAny } from "@/lib/auth/can"
import { HISTORY_MAX_ROWS, sortHistoryRows } from "@/lib/mantencion/history-view"
import { executorText, ITEM_VALUE_LABEL, RECORD_STATUS_LABEL, REVIEW_LABEL } from "@/lib/mantencion/format"
import type { MantItemValue } from "@/lib/mantencion/types"
import { EXCEL_DATE_FORMAT, EXCEL_DATETIME_FORMAT, excelDateTime, excelPlainDate } from "@/lib/reports/excel-dates"
import { buildXlsxBuffer } from "@/lib/reports/export-module/excel-builder"
import type { ReportCell, ReportData, ReportSheet } from "@/lib/reports/export-module/types"
import { todayInChile } from "@/lib/utils"
import { equipmentScope, recordVisibility, recordVisibilitySql, viewerFromSession } from "./access"
import { HISTORY_EXPORT_FORMATS, HISTORY_EXPORT_HEADERS, historySheetRow } from "./export-history"
import { RECORDS_EXPORT_LIMIT } from "./export-records"
import { loadLifeRows } from "./equipment-life"
import { loadFleet } from "./fleet"
import { loadEquipmentTimeline } from "./maintenance-work"

/**
 * Excel del historial de mantenciones de UN equipo («Exportar Excel» de su
 * ficha). Abre con lo mismo que muestra la tarjeta «Historial de mantenciones»
 * de la ficha: para quien puede ver el historial, la hoja «Historial» trae los
 * trabajos de las tres fuentes (formularios, órdenes de trabajo que entraron a
 * taller y registros firmados vigentes), con las columnas del Historial de
 * mantenciones. Antes exportaba sólo lo firmado en la app y, con un equipo que
 * sólo tenía formularios, respondía «sin mantenciones» bajo una tarjeta que
 * mostraba años de trabajos.
 *
 * El detalle de lo firmado sigue en sus hojas —«Registros firmados» (con las
 * anuladas marcadas), «Ítems de preventivas» y «Repuestos»—, sólo si el equipo
 * tiene registros. Sin permiso de historial, la ficha sólo enseña los registros
 * firmados y el libro también: abre con «Registros firmados». Las fechas van
 * como fecha real, con la fila 1 fija, el autofiltro y la hoja de metadatos, que
 * pone `buildXlsxBuffer`. Quien llama exige `mant:export`; aquí se vuelve a
 * comprobar que el equipo esté en el alcance de faenas, y cada hoja usa el
 * alcance de lectura de su tarjeta: la exportación nunca es más amplia que la
 * pantalla.
 *
 * No modifica `export-records.ts` (lo edita otra línea): sólo reutiliza su tope.
 */

export type EquipmentHistoryExportOutcome =
  | { ok: true; data: { base64: string; filename: string; truncated: boolean; rowLimit: number } }
  | { ok: false; message: string }

const KIND_LABEL = { P: "Preventiva", C: "Correctiva" } as const
const HISTORY_SHEET = "Historial"
const SIGNED_SHEET = "Registros firmados"
const yesNo = (value: boolean) => (value ? "Sí" : "No")

export async function exportEquipmentHistory(session: Session, vehicleId: string): Promise<EquipmentHistoryExportOutcome> {
  const viewer = viewerFromSession(session)
  const [equipment] = await loadFleet({ scope: equipmentScope(viewer), includeRetired: true, vehicleIds: [vehicleId], readingsPerEquipment: 1 })
  if (!equipment) return { ok: false, message: "No se encontró el equipo." }

  // El mismo permiso con que la ficha dibuja la línea de tiempo (`app/(app)/flota/[id]/mantencion/page.tsx`).
  const withHistory = canAny(session, "mant:records:view_all", "mant:records:view_worksite")
  const [timeline, { rows: fetched, hasMore }] = await Promise.all([
    withHistory ? loadEquipmentTimeline(viewer, vehicleId) : Promise.resolve(null),
    loadLifeRows(vehicleId, recordVisibilitySql(recordVisibility(viewer)), { limit: RECORDS_EXPORT_LIMIT }),
  ])
  const work = timeline ? sortHistoryRows(timeline.rows, "fecha", "desc") : []
  if (fetched.length === 0 && work.length === 0) return { ok: false, message: "Este equipo todavía no tiene mantenciones que puedas exportar." }
  const ids = fetched.map((row) => row.id)

  const [items, parts] = ids.length === 0 ? [[], []] : await Promise.all([
    db.select().from(mantRecordItems).where(inArray(mantRecordItems.recordId, ids))
      .orderBy(asc(mantRecordItems.recordId), asc(mantRecordItems.sortOrder), asc(mantRecordItems.itemName)),
    db.select().from(mantRecordParts).where(inArray(mantRecordParts.recordId, ids))
      .orderBy(asc(mantRecordParts.recordId), asc(mantRecordParts.sortOrder)),
  ])

  // Lectura anterior: la del registro vigente inmediatamente más antiguo que el
  // visible para quien exporta (las filas vienen de la más nueva a la más vieja).
  // Es «dentro de lo que ves»: no revela lecturas de registros fuera del alcance.
  const previousReading = new Map<string, number | null>()
  let lastActive: number | null = null
  for (const row of [...fetched].reverse()) {
    previousReading.set(row.id, lastActive)
    if (row.status === "vigente") lastActive = row.reading
  }

  const meta = new Map(fetched.map((row) => [row.id, { folio: row.folio ?? "", date: excelPlainDate(row.workDate) }]))
  const lead = (recordId: string): ReportCell[] => {
    const m = meta.get(recordId)!
    return [m.folio, m.date, equipment.code, equipment.plate]
  }
  const leadHeaders = ["Folio", "Fecha del trabajo", "Equipo", "Patente"]

  const signedRows: ReportCell[][] = fetched.map((r) => [
    r.folio ?? "",
    excelPlainDate(r.workDate),
    KIND_LABEL[r.kind],
    r.kind === "P" ? r.intervalValue : null,
    r.worksiteName,
    r.reading,
    r.unit,
    previousReading.get(r.id) ?? null,
    r.executorName,
    r.registeredByName,
    executorText({ executorKind: r.executorKind, registeredByName: r.registeredByName, executorName: r.executorName }),
    r.hours,
    r.kind === "C" ? yesNo(r.inWorkshop) : "",
    excelPlainDate(r.workshopEntryDate),
    excelPlainDate(r.workshopExitDate),
    r.daysInWorkshop,
    RECORD_STATUS_LABEL[r.status],
    REVIEW_LABEL[r.review],
    r.voidReason ?? "",
    r.voidedByName ?? "",
    excelDateTime(r.voidedAt),
    excelDateTime(r.signedAt),
    excelDateTime(r.receivedAt),
  ])
  const signedHeaders = [
    "Folio", "Fecha del trabajo", "Tipo", "Intervalo", "Faena", "Lectura", "Unidad", "Lectura anterior",
    "Hecho por", "Registrado por", "Detalle de autoría", "Horas", "Pasó por taller", "Entró a taller", "Salió de taller", "Días en taller",
    "Estado", "Revisión", "Motivo de anulación", "Anulado por", "Anulado el", "Firmado en el teléfono", "Recibido en la plataforma",
  ]

  const leadFormats = { 1: EXCEL_DATE_FORMAT }
  const signedFormats = {
    1: EXCEL_DATE_FORMAT, 3: "#,##0", 5: "#,##0.0", 7: "#,##0.0", 11: "0.0",
    13: EXCEL_DATE_FORMAT, 14: EXCEL_DATE_FORMAT, 20: EXCEL_DATETIME_FORMAT, 21: EXCEL_DATETIME_FORMAT, 22: EXCEL_DATETIME_FORMAT,
  }
  const signedSheet: ReportSheet = { worksheetName: SIGNED_SHEET, headers: signedHeaders, rows: signedRows, columnFormats: signedFormats }
  const signedDetail: ReportSheet[] = [
    {
      worksheetName: "Ítems de preventivas",
      headers: [...leadHeaders, "Sistema", "Ítem", "Resultado", "Motivo", "Aviso del fabricante"],
      rows: items.map((item) => [
        ...lead(item.recordId), item.groupName, item.itemName, ITEM_VALUE_LABEL[item.value as MantItemValue], item.reason ?? "",
        yesNo(item.manufacturerWarning),
      ]),
      columnFormats: leadFormats,
    },
    {
      worksheetName: "Repuestos",
      headers: [...leadHeaders, "Cantidad", "Repuesto"],
      rows: parts.map((part) => [...lead(part.recordId), part.quantity, part.description]),
      columnFormats: leadFormats,
    },
  ]

  const workTruncated = work.length > HISTORY_MAX_ROWS
  const truncated = hasMore || workTruncated
  // Con historial, la hoja primaria es la de la tarjeta y las de firmados van detrás (sólo si los hay); sin él, la
  // primaria es la de firmados, que entonces no está vacía (sin firmados ni historial ya se respondió arriba).
  const signedSheets = fetched.length === 0 ? [] : [signedSheet, ...signedDetail]
  const report: ReportData = timeline
    ? {
        filenameBase: "historial-mantenciones",
        worksheetName: HISTORY_SHEET,
        headers: [...HISTORY_EXPORT_HEADERS],
        rows: work.slice(0, HISTORY_MAX_ROWS).map(historySheetRow),
        columnFormats: HISTORY_EXPORT_FORMATS,
        sheets: signedSheets,
        rowLimitApplied: truncated,
      }
    : { filenameBase: "historial-mantenciones", ...signedSheet, sheets: signedDetail, rowLimitApplied: truncated }
  const notes = timeline
    ? [
        `Hoja «${HISTORY_SHEET}»: los mismos trabajos que la tarjeta «Historial de mantenciones» de la ficha: formularios, órdenes de trabajo que entraron a taller y registros firmados vigentes.`,
        ...(fetched.length > 0 ? [`Hoja «${SIGNED_SHEET}»: el detalle de lo firmado en la app, con las anuladas marcadas.`] : []),
        ...(timeline.includesOrders ? [] : ["Tu perfil no ve todas las órdenes de trabajo de este equipo: este libro no las incluye."]),
      ]
    : []
  const buffer = await buildXlsxBuffer(report, {
    session,
    filters: { equipo: equipment.code },
    rowLimit: workTruncated ? HISTORY_MAX_ROWS : RECORDS_EXPORT_LIMIT,
    ...(notes.length > 0 ? { notes } : {}),
  })

  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "export",
    entityType: "mant_equipment",
    entityId: vehicleId,
    entityCode: equipment.code,
    newState: { export: "historial_mantenciones", rowCount: timeline ? work.length : fetched.length, signedCount: fetched.length, truncated },
    worksiteId: equipment.worksiteId,
  })

  return {
    ok: true,
    data: {
      base64: Buffer.from(buffer).toString("base64"),
      filename: `historial-${equipment.code.replace(/[^\w.-]+/g, "_")}-${todayInChile()}.xlsx`,
      truncated,
      rowLimit: workTruncated ? HISTORY_MAX_ROWS : RECORDS_EXPORT_LIMIT,
    },
  }
}
