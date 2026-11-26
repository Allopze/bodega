import { FORMS_CUTOVER_DATE, FORMS_LAST_COUNTED_DATE } from "@/lib/mantencion/forms-cutover"
import type { MantUnit } from "@/lib/mantencion/types"
import { EXCEL_DATE_FORMAT, excelPlainDate } from "@/lib/reports/excel-dates"
import { sanitizeCell } from "@/lib/reports/export-module/excel-builder"
import type { ReportSheet } from "@/lib/reports/export-module/types"
import { formatDate } from "@/lib/utils"
import { WORK_SOURCE_LABEL } from "../maintenance-work-sheet"
import { matrixCellText } from "./preventive-summary"
import type {
  ChecklistMatrix, ComplianceBucket, ComplianceByPlate, CorrectiveWorkRow, DriverRow, EquipmentSeriesRow, MatrixCheck,
} from "./types"

/**
 * Hojas de «Por kilómetros» y «Por horas» del Excel: el correctivo (trabajos, conductores y horas por equipo) y el
 * preventivo (cumplimiento por mes, por faena y mecánico, por patente, y la matriz de checklist). Módulo PURO:
 * recibe lo que ya cargó `loadWorkControlData`. Una dimensión sin valor lleva el rótulo de la pantalla («Sin
 * faena», «Sin mecánico»); una medida que no existe va vacía, nunca en cero.
 */

const HOURS_FORMAT = "#,##0.0"
const PERCENT_FORMAT = "0.0"

export const WORK_SHEET_NAMES = {
  corrective: "Correctivos",
  drivers: "Conductores",
  series: "Horas y registros",
  byMonth: "Cumplimiento por mes",
  byWorksite: "Cumplimiento faena y mecánico",
  byPlate: "Cumplimiento por patente",
  matrix: "Matriz de checklist",
  matrixChecks: "Pautas de la matriz",
} as const

export function correctiveSheet(rows: readonly CorrectiveWorkRow[], unit: MantUnit): ReportSheet {
  return {
    worksheetName: WORK_SHEET_NAMES.corrective,
    headers: [
      "Fecha", "Fuente", "Referencia", "Código", "Patente", "Tipo de equipo", "Faena",
      unit === "km" ? "Odómetro (km)" : "Horómetro (h)", "Lectura del formulario", "Horas hombre", "Trabajo realizado",
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
      row.hours,
      row.workPerformed || null,
    ]),
    columnFormats: { 0: EXCEL_DATE_FORMAT, 7: unit === "km" ? "#,##0" : HOURS_FORMAT, 9: HOURS_FORMAT },
  }
}

export function driversSheet(drivers: readonly DriverRow[]): ReportSheet {
  return {
    worksheetName: WORK_SHEET_NAMES.drivers,
    headers: ["Conductor", "Horas (prorrateadas)", "Registros"],
    rows: drivers.map((driver) => [driver.label, driver.hours, driver.records]),
    columnFormats: { 1: HOURS_FORMAT },
  }
}

export function equipmentSeriesSheet(series: readonly EquipmentSeriesRow[]): ReportSheet {
  return {
    worksheetName: WORK_SHEET_NAMES.series,
    headers: ["Equipo", "Horas trabajadas", "Registros"],
    rows: series.map((row) => [row.label, row.hours, row.records]),
    columnFormats: { 1: HOURS_FORMAT },
  }
}

export function complianceByMonthSheet(buckets: readonly ComplianceBucket[]): ReportSheet {
  return {
    worksheetName: WORK_SHEET_NAMES.byMonth,
    headers: ["Mes", "Cumplimiento (%)", "Pautas"],
    rows: buckets.map((bucket) => [bucket.label, bucket.percent, bucket.checks]),
    columnFormats: { 1: PERCENT_FORMAT },
  }
}

export function complianceByWorksiteMechanicSheet(buckets: readonly ComplianceBucket[]): ReportSheet {
  return {
    worksheetName: WORK_SHEET_NAMES.byWorksite,
    headers: ["Faena", "Mecánico", "Cumplimiento (%)", "Pautas"],
    rows: buckets.map((bucket) => [bucket.worksiteName ?? "Sin faena", bucket.mechanicLabel ?? "Sin mecánico", bucket.percent, bucket.checks]),
    columnFormats: { 2: PERCENT_FORMAT },
  }
}

export function complianceByPlateSheet(rows: readonly ComplianceByPlate[]): ReportSheet {
  return {
    worksheetName: WORK_SHEET_NAMES.byPlate,
    headers: ["Patente", "Código", "Faena", "Niveles de pauta", "Cumplimiento (%)", "Pautas"],
    rows: rows.map((row) => [
      row.plate || null,
      row.code || null,
      row.worksiteName ?? "Sin faena",
      row.levels.length > 0 ? row.levels.join(" · ") : null,
      row.percent,
      row.checks,
    ]),
    columnFormats: { 4: PERCENT_FORMAT },
  }
}

/** Cómo se llama una columna de la matriz: el equipo, la fecha y el nivel de la pauta, como en la pantalla. */
function checkLabel(check: MatrixCheck): string {
  return `${check.code || check.plate || "Equipo"} · ${formatDate(check.date)} · ${check.level}`
}

/**
 * El libro sanea las celdas de DATOS al escribirlas (`sanitizeCell`), pero no su fila de encabezado. El nombre de una
 * columna de la matriz sale del código y la patente del equipo, que en el histórico son texto libre: se neutraliza aquí
 * (un valor que parte con `=`, `+`, `-` o `@` queda como texto), igual que la celda de la hoja «Pautas de la matriz».
 */
function checkHeader(check: MatrixCheck): string {
  return String(sanitizeCell(checkLabel(check)))
}

/** Ítems en filas, una columna por pauta. Un ítem que la pauta no trae queda vacío (no es «no realizado»). */
export function checklistMatrixSheet(matrix: ChecklistMatrix): ReportSheet {
  return {
    worksheetName: WORK_SHEET_NAMES.matrix,
    headers: ["Ítem", "Sistema", ...matrix.checks.map(checkHeader)],
    rows: matrix.items.map((item) => [
      item.name,
      item.group,
      ...matrix.checks.map((check) => {
        const state = check.items[item.name]
        return state ? matrixCellText(state) : null
      }),
    ]),
  }
}

/** Lo que la pantalla muestra en el encabezado de cada columna de la matriz y bajo ella (observaciones y fotos). */
export function matrixChecksSheet(matrix: ChecklistMatrix): ReportSheet {
  return {
    worksheetName: WORK_SHEET_NAMES.matrixChecks,
    headers: [
      "Pauta (columna de la matriz)", "Código", "Patente", "Fecha", "Nivel de pauta", "Mecánico", "Faena", "Fuente", "Observaciones",
      "Fotos en la plataforma", "Enlaces de respaldo",
    ],
    rows: matrix.checks.map((check) => [
      checkLabel(check),
      check.code || null,
      check.plate || null,
      excelPlainDate(check.date),
      check.level,
      check.mechanic ?? "Sin mecánico",
      check.worksiteName ?? "Sin faena",
      WORK_SOURCE_LABEL[check.source],
      check.observations,
      check.photoIds.length,
      check.photoUrls.length > 0 ? check.photoUrls.map((photo) => `${photo.label}: ${photo.url}`).join("; ") : null,
    ]),
    columnFormats: { 3: EXCEL_DATE_FORMAT },
  }
}

/** Las notas de lectura de la pantalla para la hoja «Filtros». */
export function workNotes(unit: MantUnit, matrix: ChecklistMatrix, matrixLimit: number): string[] {
  const subject = unit === "km" ? "equipos por kilómetros" : "equipos por horas"
  const notes = [
    `Correctivo: OT con ingreso a taller y correctivas del período, sólo ${subject}. La fecha es el ingreso a taller. La hoja «Correctivos» trae todos los trabajos del filtro (la pantalla los muestra de 25 en 25).`,
    `Preventivo: pautas de formularios hasta el ${formatDate(FORMS_LAST_COUNTED_DATE)} y registros de la plataforma desde el ${formatDate(FORMS_CUTOVER_DATE)}, sólo ${subject}.`,
    "Conductores: horas prorrateadas entre los conductores de cada registro. Los nombres del histórico son texto libre y no se cruzaron entre fuentes.",
    "Cumplimiento: el % de una pauta es realizados / (realizados + no realizados); «No aplica» no entra. El % de un mes, de una faena y mecánico o de una patente es el promedio de los % de cada pauta, no el cociente de los totales. Los nombres de mecánico del histórico son texto libre.",
    "«Horas y registros» trae todos los equipos con trabajos (el gráfico dibuja los 8 con más horas); «Cumplimiento faena y mecánico» trae todas las combinaciones (el gráfico, las 12 primeras).",
    `La matriz de checklist trae hasta ${matrixLimit} pautas con detalle por ítem, las más recientes (la pantalla muestra las últimas 8). «Pautas de la matriz» lleva el mecánico y las observaciones de cada una.`,
    "Las fotos no se exportan: de las pautas va la cantidad de fotos de la plataforma y los enlaces de respaldo del histórico; de los trabajos correctivos, nada.",
    "Una celda vacía es un dato que no existe, no un cero.",
    "Los filtros cruzados actúan como en la pantalla: cada hoja ignora la selección que ella misma emite (p. ej. «Conductores» muestra a todos y «Correctivos» no se reduce a la OT elegida).",
  ]
  if (matrix.withoutDetail > 0) {
    notes.push(`${matrix.withoutDetail} de las últimas pautas no traen detalle por ítem y no se incluyen como columna de la matriz.`)
  }
  return notes
}
