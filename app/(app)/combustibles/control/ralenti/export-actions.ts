"use server"

import { can, requirePermission } from "@/lib/auth/can"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { parseControlFilters } from "@/lib/combustibles/control/filters"
import { getIdleEquipmentMonths, getIdleTopDays } from "@/lib/combustibles/control/queries/idle"
import { getLitersPerHourComparison } from "@/lib/combustibles/control/queries/idle-comparison"
import { addTableSheet, type SheetRow } from "@/lib/combustibles/control/queries/xlsx-sheet"
import { addExportMetadataSheet } from "@/lib/combustibles/xlsx-utils"
import { xlsxToBase64 } from "@/lib/reports/export-module/excel-builder"
import { formatDate, todayInChile } from "@/lib/utils"
import type { ExportActionResult } from "@/components/ui/export-button"

/** Exporta las tablas de ralentí (V-01..V-05, V-08 y V-09) con los mismos filtros de la vista. */
export async function exportIdleXlsxAction(input: { query: string }): Promise<ExportActionResult> {
  let session
  try {
    session = await requirePermission("combustibles:export", "/combustibles/control/ralenti")
    if (!can(session, "combustibles:view")) return { ok: false, message: "Sin permisos" }
  } catch { return { ok: false, message: "Sin permisos" } }

  const filters = parseControlFilters(Object.fromEntries(new URLSearchParams((input.query ?? "").slice(0, 2000))))
  const [months, comparison, topDays] = await Promise.all([
    getIdleEquipmentMonths(session, filters),
    getLitersPerHourComparison(session, filters),
    getIdleTopDays(session, filters, 20),
  ])

  const ExcelJS = await import("exceljs")
  const wb = new ExcelJS.Workbook()
  const statColumns = [
    { header: "Horas de funcionamiento", key: "operating", width: 14, numFmt: "#,##0.0" },
    { header: "% en vacío (mes)", key: "idlePct", width: 12, numFmt: "#,##0.0" },
    { header: "% en vacío, promedio diario", key: "dailyAvg", width: 14, numFmt: "#,##0.0" },
    { header: "% en vacío, máximo diario", key: "dailyMax", width: 14, numFmt: "#,##0.0" },
    { header: "% en vacío, mínimo diario", key: "dailyMin", width: 14, numFmt: "#,##0.0" },
    { header: "Horas trabajando por día", key: "workPerDay", width: 14, numFmt: "#,##0.0" },
    { header: "Horas en vacío por día", key: "idlePerDay", width: 14, numFmt: "#,##0.0" },
    { header: "Litros trabajando", key: "litersWorking", width: 14, numFmt: "#,##0.0" },
    { header: "Litros en vacío", key: "litersIdle", width: 14, numFmt: "#,##0.0" },
  ]
  const statRow = (stats: (typeof months.rows)[number] | NonNullable<typeof months.total>): SheetRow => ({
    operating: stats.operatingHours, idlePct: stats.idlePct, dailyAvg: stats.dailyAvgPct, dailyMax: stats.dailyMaxPct, dailyMin: stats.dailyMinPct,
    workPerDay: stats.avgWorkingPerDay, idlePerDay: stats.avgIdlePerDay, litersWorking: stats.litersWorking, litersIdle: stats.litersIdle,
  })
  addTableSheet(wb, "Ralentí equipo y mes", [
    { header: "Equipo", key: "equipment", width: 24 },
    { header: "Mes", key: "month", width: 10 },
    ...statColumns,
  ], months.rows.map((row) => ({ equipment: row.equipment, month: row.month, ...statRow(row) })),
  months.total ? { equipment: "Total general", month: null, ...statRow(months.total) } : undefined)
  addTableSheet(wb, "L-h telemetría vs cargas", [
    { header: "Equipo", key: "equipment", width: 24 },
    { header: "Mes", key: "month", width: 10 },
    { header: "L/h según telemetría", key: "telemetry", width: 16, numFmt: "#,##0.00" },
    { header: "L/h desde cargas", key: "loads", width: 16, numFmt: "#,##0.00" },
    { header: "Cargas consideradas", key: "count", width: 12 },
    { header: "Diferencia %", key: "diff", width: 12, numFmt: "#,##0.0" },
  ], comparison.map((row) => ({
    equipment: row.equipment, month: row.month, telemetry: row.telemetryLph,
    loads: row.loadsLph ?? "Sin cargas en el mes", count: row.loadCount, diff: row.differencePct,
  })))
  addTableSheet(wb, "Días con más ralentí", [
    { header: "Fecha", key: "day", width: 12 },
    { header: "Equipo", key: "equipment", width: 24 },
    { header: "Horas de funcionamiento", key: "operating", width: 14, numFmt: "#,##0.0" },
    { header: "Horas en vacío", key: "idle", width: 14, numFmt: "#,##0.0" },
    { header: "% en vacío", key: "pct", width: 12, numFmt: "#,##0.0" },
  ], topDays.map((row) => ({ day: formatDate(row.day), equipment: row.equipment, operating: row.operatingHours, idle: row.idleHours, pct: row.idlePct })))
  addExportMetadataSheet(wb, session, { filters, rowCount: months.rows.length, from: filters.from, to: filters.to })

  const base64 = await xlsxToBase64(wb)
  await recordAudit({
    userId: session.user.id, userEmail: session.user.email ?? undefined, action: "export",
    entityType: "fuel_control_idle_export", entityId: nanoid(),
    newState: { rowCount: months.rows.length, filters: filters as unknown as Record<string, unknown> },
  })
  return { ok: true, data: { base64, filename: `control_ralenti_${todayInChile()}.xlsx` } }
}
