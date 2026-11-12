import type { Session } from "next-auth"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { EQUIPMENT_STATE_LABEL, formatHours } from "@/lib/mantencion/format"
import { MANT_EQUIPMENT_STATES } from "@/lib/mantencion/types"
import { EXCEL_DATE_FORMAT, excelPlainDate } from "@/lib/reports/excel-dates"
import { formatDate } from "@/lib/utils"
import { buildXlsxBuffer } from "@/lib/reports/export-module/excel-builder"
import type { ReportData } from "@/lib/reports/export-module/types"
import { viewerFromSession } from "./access"
import type { ExportOutcome } from "./export-records"
import { loadPanel, loadPanelWorksites } from "./panel"
import { fleetCoverage } from "./panel-coverage"
import { PANEL_PERIOD_PHRASE, type PanelFilters } from "./panel-filters"

/**
 * Libro «Panel» (§12): los mismos indicadores y tablas que la pantalla, con los
 * filtros aplicados (el período y la faena van también en la hoja de metadatos).
 * Sale de `loadPanel`, así que lo que baja la persona es lo que estaba viendo y
 * respeta su alcance.
 */
export async function exportPanel(input: { session: Session; filters: PanelFilters }): Promise<ExportOutcome> {
  const viewer = viewerFromSession(input.session)
  // Igual que la página: una faena de la URL que no está en el alcance de quien exporta no se
  // aplica (ni se nombra, que sería revelar que existe) y el libro sale con todo su alcance.
  const scopeWorksites = await loadPanelWorksites(viewer)
  const worksite = input.filters.worksiteId ? scopeWorksites.find((item) => item.id === input.filters.worksiteId) : undefined
  const filters: PanelFilters = { ...input.filters, worksiteId: worksite?.id }
  const data = await loadPanel(viewer, filters)
  const worksiteName = worksite?.name ?? "Todas las faenas"
  const period = PANEL_PERIOD_PHRASE[filters.period]
  const coverage = fleetCoverage(data.fleet.counts)

  const report: ReportData = {
    filenameBase: "panel-mantencion",
    worksheetName: "Indicadores",
    headers: ["Indicador", "Valor", "Detalle"],
    rows: [
      ["Período", period, data.from ? `Desde el ${formatDate(data.from)}` : "Sin límite de fecha"],
      ["Faena", worksiteName, ""],
      ["Registros del período", data.records.total, `${data.records.preventive} preventivas · ${data.records.corrective} correctivas · ${data.records.pendingReview} por revisar`],
      // «0 vencidas» no es «todo al día» si hay equipos que no se pudieron evaluar: el libro lo dice igual que la pantalla.
      ["Mantenciones vencidas", data.fleet.counts.vencida, `${data.fleet.counts.proxima} próximas a vencer · ${coverage.evaluable} de ${data.fleet.active} equipos con pauta y lectura`],
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
        headers: ["Equipo", "Patente", "Faena", "Pauta", "Unidad", "Lectura", "Próxima", "Falta", "Pauta que toca", "Estado", "Días en taller"],
        rows: data.upcoming.map((row) => [
          row.code, row.plate, row.worksiteName, row.scheduleName ?? "", row.unit, row.reading, row.nextReading, row.remaining,
          row.nextIntervalValue, EQUIPMENT_STATE_LABEL[row.state], row.workshopDays,
        ]),
      },
      {
        worksheetName: "En taller ahora",
        headers: ["Equipo", "Patente", "Faena", "Folio", "Trabajo", "Motivo de seguir en taller", "Días detenido", "Sin actualizar"],
        rows: data.workshop.rows.map((row) => [row.code, row.plate, row.worksiteName, row.folio ?? "", row.summary, row.reason ?? "", row.daysStopped, row.stale ? "Sí" : "No"]),
      },
      {
        worksheetName: "Horas por faena",
        headers: ["Faena", "Horas hombre (h)"],
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
    filters: { periodo: filters.period, faena: worksiteName },
  })
  await recordAudit({
    userId: input.session.user.id,
    userEmail: input.session.user.email ?? undefined,
    action: "export",
    entityType: "mant_panel_export",
    entityId: nanoid(),
    worksiteId: filters.worksiteId ?? null,
    newState: { filters: { ...filters }, hours: formatHours(data.records.hours) },
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
