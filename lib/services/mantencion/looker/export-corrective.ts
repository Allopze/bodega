import type { MantUnit } from "@/lib/mantencion/types"
import { EXCEL_DATE_FORMAT, excelPlainDate } from "@/lib/reports/excel-dates"
import type { ReportSheet } from "@/lib/reports/export-module/types"
import { WORK_SOURCE_LABEL } from "../maintenance-work-sheet"
import type { CorrectiveWorkRow, DriverRow, EquipmentSeriesRow, MonthlyCount } from "./types"

/**
 * Hojas del Excel de la pestaña Correctivo: los trabajos, los conductores, las horas y registros por equipo y los
 * trabajos por mes. Módulo PURO: recibe lo que ya cargó `loadCorrectiveTabData` (`corrective-tab-data.ts`). Una medida que no existe va
 * vacía, nunca en cero.
 */

const HOURS_FORMAT = "#,##0.0"

export const CORRECTIVE_SHEET_NAMES = {
  corrective: "Correctivos",
  drivers: "Conductores",
  series: "Horas y registros",
  monthly: "Trabajos por mes",
} as const

export function correctiveSheet(rows: readonly CorrectiveWorkRow[], unit: MantUnit): ReportSheet {
  return {
    worksheetName: CORRECTIVE_SHEET_NAMES.corrective,
    headers: [
      "Fecha", "Fuente", "Referencia", "Código", "Patente", "Tipo de equipo", "Faena",
      unit === "km" ? "Odómetro (km)" : "Horómetro (h)", "Lectura del formulario", "Conductor", "Horas hombre", "Trabajo realizado",
    ],
    rows: rows.map((row) => [
      excelPlainDate(row.date),
      WORK_SOURCE_LABEL[row.source],
      row.reference || null,
      row.code || null,
      row.plate || null,
      row.typeName || null,
      row.worksiteName ?? "Sin faena",
      row.reading,
      row.readingText,
      row.drivers.join(", ") || null,
      row.hours,
      row.workPerformed || null,
    ]),
    columnFormats: { 0: EXCEL_DATE_FORMAT, 7: unit === "km" ? "#,##0" : HOURS_FORMAT, 10: HOURS_FORMAT },
  }
}

export function driversSheet(drivers: readonly DriverRow[]): ReportSheet {
  return {
    worksheetName: CORRECTIVE_SHEET_NAMES.drivers,
    headers: ["Conductor", "Horas (prorrateadas)", "Registros"],
    rows: drivers.map((driver) => [driver.label, driver.hours, driver.records]),
    columnFormats: { 1: HOURS_FORMAT },
  }
}

export function equipmentSeriesSheet(series: readonly EquipmentSeriesRow[]): ReportSheet {
  return {
    worksheetName: CORRECTIVE_SHEET_NAMES.series,
    headers: ["Patente", "Código", "Horas trabajadas", "Registros"],
    rows: series.map((row) => [row.plate || null, row.code || null, row.hours, row.records]),
    columnFormats: { 2: HOURS_FORMAT },
  }
}

export function monthlyWorkSheet(months: readonly MonthlyCount[]): ReportSheet {
  return {
    worksheetName: CORRECTIVE_SHEET_NAMES.monthly,
    headers: ["Mes", "Trabajos correctivos"],
    rows: months.map((month) => [month.label, month.count]),
  }
}

/** Las notas de lectura de la pantalla para la hoja «Filtros». */
export function correctiveNotes(unit: MantUnit): string[] {
  const subject = unit === "km" ? "equipos por kilómetros" : "equipos por horas"
  return [
    `OT con ingreso a taller y correctivas del período, sólo ${subject}. La fecha es el ingreso a taller. La hoja «Correctivos» trae todos los trabajos del filtro (la pantalla los muestra de 25 en 25).`,
    "Conductores: horas prorrateadas entre los conductores de cada registro. Los nombres del histórico son texto libre y no se cruzaron entre fuentes.",
    "«Horas y registros» trae todos los equipos con trabajos (el gráfico dibuja los que caben). «Trabajos por mes» cuenta todos los meses del período; el mes en curso está incompleto.",
    "Las fotos no se exportan.",
    "Una celda vacía es un dato que no existe, no un cero.",
    "Los filtros cruzados actúan como en la pantalla: cada hoja ignora la selección que ella misma emite (p. ej. «Conductores» muestra a todos, «Trabajos por mes» a todos los meses y «Correctivos» no se reduce a la OT elegida).",
  ]
}
