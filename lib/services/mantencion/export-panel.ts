import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import { worksites } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { EQUIPMENT_STATE_LABEL, formatHours } from "@/lib/mantencion/format"
import { MANT_EQUIPMENT_STATES } from "@/lib/mantencion/types"
import { EXCEL_DATE_FORMAT, excelPlainDate } from "@/lib/reports/excel-dates"
import { buildXlsxBuffer } from "@/lib/reports/export-module/excel-builder"
import type { ReportData } from "@/lib/reports/export-module/types"
import { viewerFromSession } from "./access"
import type { ExportOutcome } from "./export-records"
import { loadPanel } from "./panel"
import { PANEL_PERIOD_PHRASE, type PanelFilters } from "./panel-filters"

/**
 * Libro «Panel» (§12): los mismos indicadores y tablas que la pantalla, con los
 * filtros aplicados (el período y la faena van también en la hoja de metadatos).
 * Sale de `loadPanel`, así que lo que baja la persona es lo que estaba viendo y
 * respeta su alcance.
 */
export async function exportPanel(input: { session: Session; filters: PanelFilters }): Promise<ExportOutcome> {
  const data = await loadPanel(viewerFromSession(input.session), input.filters)
  const worksiteName = input.filters.worksiteId
    ? (await db.select({ name: worksites.name }).from(worksites).where(eq(worksites.id, input.filters.worksiteId)).limit(1))[0]?.name ?? "Faena desconocida"
    : "Todas las faenas"
  const period = PANEL_PERIOD_PHRASE[input.filters.period]

  const report: ReportData = {
    filenameBase: "panel-mantencion",
    worksheetName: "Indicadores",
    headers: ["Indicador", "Valor", "Detalle"],
    rows: [
      ["Período", period, data.from ? `Desde el ${data.from}` : "Sin límite de fecha"],
      ["Faena", worksiteName, ""],
      ["Registros del período", data.records.total, `${data.records.preventive} preventivas · ${data.records.corrective} correctivas`],
      ["Mantenciones vencidas", data.fleet.counts.vencida, `${data.fleet.counts.proxima} próximas a vencer`],
      ["Equipos en taller", data.workshop.equipment, `${data.workshop.stale} sin actualizar hace más de 2 días`],
      ["Días fuera de servicio del período", data.stoppedDays.total, `En ${data.stoppedDays.equipment} equipos`],
      ["Horas hombre del período (h)", data.records.hours, `En ${data.records.corrective} correctivas`],
      ["Equipos activos", data.fleet.active, ""],
    ],
    columnFormats: {},
    sheets: [
      {
        worksheetName: "Registros por semana",
        headers: ["Semana que empieza el", "Preventivas", "Correctivas"],
        rows: data.weeks.map((week) => [excelPlainDate(week.start), week.preventive, week.corrective]),
        columnFormats: { 0: EXCEL_DATE_FORMAT },
      },
      {
        worksheetName: "Estado de la flota",
        headers: ["Estado", "Equipos"],
        rows: MANT_EQUIPMENT_STATES.filter((state) => state !== "baja").map((state) => [EQUIPMENT_STATE_LABEL[state], data.fleet.counts[state]]),
      },
      {
        worksheetName: "Próximas mantenciones",
        headers: ["Equipo", "Patente", "Faena", "Pauta", "Unidad", "Lectura", "Próxima", "Falta", "Pauta que toca", "Estado"],
        rows: data.upcoming.map((row) => [
          row.code, row.plate, row.worksiteName, row.scheduleName ?? "", row.unit, row.reading, row.nextReading, row.remaining,
          row.nextIntervalValue, EQUIPMENT_STATE_LABEL[row.state],
        ]),
      },
      {
        worksheetName: "En taller ahora",
        headers: ["Equipo", "Patente", "Faena", "Folio", "Trabajo", "Días detenido", "Sin actualizar"],
        rows: data.workshop.rows.map((row) => [row.code, row.plate, row.worksiteName, row.folio ?? "", row.summary, row.daysStopped, row.stale ? "Sí" : "No"]),
      },
      {
        worksheetName: "Horas por faena",
        headers: ["Faena", "Horas de taller (h)"],
        rows: data.hoursByWorksite.map((row) => [row.worksiteName, row.hours]),
        columnFormats: { 1: "0.0" },
      },
      {
        worksheetName: "Ítems sin hacer",
        headers: ["Ítem", "Sistema", "Veces sin hacer", "Último motivo"],
        rows: data.notDone.map((row) => [row.item, row.group, row.count, row.lastReason ?? ""]),
      },
    ],
  }
  const buffer = await buildXlsxBuffer(report, {
    session: input.session,
    filters: { periodo: input.filters.period, faena: worksiteName },
  })
  await recordAudit({
    userId: input.session.user.id,
    userEmail: input.session.user.email ?? undefined,
    action: "export",
    entityType: "mant_panel_export",
    entityId: nanoid(),
    worksiteId: input.filters.worksiteId ?? null,
    newState: { filters: { ...input.filters }, hours: formatHours(data.records.hours) },
  })
  return {
    ok: true,
    data: {
      base64: Buffer.from(buffer).toString("base64"),
      filename: `panel-mantencion-${data.today}.xlsx`,
      truncated: false,
      rowLimit: 0,
    },
  }
}
