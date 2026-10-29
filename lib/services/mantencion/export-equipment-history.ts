import { asc, inArray } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import { mantRecordItems, mantRecordParts } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { executorText, ITEM_VALUE_LABEL, RECORD_STATUS_LABEL, REVIEW_LABEL } from "@/lib/mantencion/format"
import type { MantItemValue } from "@/lib/mantencion/types"
import { EXCEL_DATE_FORMAT, EXCEL_DATETIME_FORMAT, excelDateTime, excelPlainDate } from "@/lib/reports/excel-dates"
import { buildXlsxBuffer } from "@/lib/reports/export-module/excel-builder"
import type { ReportCell, ReportData, ReportSheet } from "@/lib/reports/export-module/types"
import { todayInChile } from "@/lib/utils"
import { equipmentScope, recordVisibility, recordVisibilitySql, viewerFromSession } from "./access"
import { RECORDS_EXPORT_LIMIT } from "./export-records"
import { loadLifeRows } from "./equipment-life"
import { loadFleet } from "./fleet"

/**
 * Excel del historial de mantenciones de UN equipo (desde su ficha). Libro de
 * tres hojas —«Historial», «Ítems de preventivas» y «Repuestos»— con las fechas
 * como fecha real, la fila 1 fija, el autofiltro y la hoja de metadatos, que
 * pone `buildXlsxBuffer`. Incluye las anuladas, marcadas, igual que la hoja de
 * vida. Quien llama exige `mant:export`; aquí se vuelve a comprobar que el
 * equipo esté en el alcance de faenas y se filtran los registros por
 * `recordVisibilitySql`: la exportación nunca es más amplia que la pantalla.
 *
 * No modifica `export-records.ts` (lo edita otra línea): sólo reutiliza su tope.
 */

export type EquipmentHistoryExportOutcome =
  | { ok: true; data: { base64: string; filename: string; truncated: boolean; rowLimit: number } }
  | { ok: false; message: string }

const KIND_LABEL = { P: "Preventiva", C: "Correctiva" } as const
const yesNo = (value: boolean) => (value ? "Sí" : "No")

export async function exportEquipmentHistory(session: Session, vehicleId: string): Promise<EquipmentHistoryExportOutcome> {
  const viewer = viewerFromSession(session)
  const [equipment] = await loadFleet({ scope: equipmentScope(viewer), includeRetired: true, vehicleIds: [vehicleId], readingsPerEquipment: 1 })
  if (!equipment) return { ok: false, message: "No se encontró el equipo." }

  const { rows: fetched, hasMore } = await loadLifeRows(vehicleId, recordVisibilitySql(recordVisibility(viewer)), { limit: RECORDS_EXPORT_LIMIT })
  if (fetched.length === 0) return { ok: false, message: "Este equipo todavía no tiene mantenciones que puedas exportar." }
  const ids = fetched.map((row) => row.id)

  const [items, parts] = await Promise.all([
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

  const historyRows: ReportCell[][] = fetched.map((r) => [
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
  const historyHeaders = [
    "Folio", "Fecha del trabajo", "Tipo", "Intervalo", "Faena", "Lectura", "Unidad", "Lectura anterior",
    "Hecho por", "Registrado por", "Detalle de autoría", "Horas", "Pasó por taller", "Entró a taller", "Salió de taller", "Días en taller",
    "Estado", "Revisión", "Motivo de anulación", "Anulado por", "Anulado el", "Firmado en el teléfono", "Recibido en la plataforma",
  ]

  const leadFormats = { 1: EXCEL_DATE_FORMAT }
  const sheets: ReportSheet[] = [
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

  const report: ReportData = {
    filenameBase: "historial-mantenciones",
    worksheetName: "Historial",
    headers: historyHeaders,
    rows: historyRows,
    columnFormats: {
      1: EXCEL_DATE_FORMAT, 3: "#,##0", 5: "#,##0.0", 7: "#,##0.0", 11: "0.0",
      13: EXCEL_DATE_FORMAT, 14: EXCEL_DATE_FORMAT, 20: EXCEL_DATETIME_FORMAT, 21: EXCEL_DATETIME_FORMAT, 22: EXCEL_DATETIME_FORMAT,
    },
    sheets,
    rowLimitApplied: hasMore,
  }
  const buffer = await buildXlsxBuffer(report, { session, filters: { equipo: equipment.code }, rowLimit: RECORDS_EXPORT_LIMIT })

  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "export",
    entityType: "mant_equipment",
    entityId: vehicleId,
    entityCode: equipment.code,
    newState: { export: "historial_mantenciones", rowCount: fetched.length, truncated: hasMore },
    worksiteId: equipment.worksiteId,
  })

  return {
    ok: true,
    data: {
      base64: Buffer.from(buffer).toString("base64"),
      filename: `historial-${equipment.code.replace(/[^\w.-]+/g, "_")}-${todayInChile()}.xlsx`,
      truncated: hasMore,
      rowLimit: RECORDS_EXPORT_LIMIT,
    },
  }
}
