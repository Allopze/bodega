import { FORMS_CUTOVER_DATE, FORMS_LAST_COUNTED_DATE } from "@/lib/mantencion/forms-cutover"
import type { MantUnit } from "@/lib/mantencion/types"
import { EXCEL_DATE_FORMAT, excelPlainDate } from "@/lib/reports/excel-dates"
import { sanitizeCell } from "@/lib/reports/export-module/excel-builder"
import type { ReportSheet } from "@/lib/reports/export-module/types"
import { formatDate } from "@/lib/utils"
import { WORK_SOURCE_LABEL } from "../maintenance-work-sheet"
import { matrixCellText, photosText } from "./preventive-summary"
import type { ChecklistMatrix, ComplianceBucket, ComplianceByPlate, MatrixCheck } from "./types"

/**
 * Hojas del Excel de la pestaña Preventivo: cumplimiento por mes, por faena y mecánico, por equipo, y la matriz de
 * checklist. Módulo PURO: recibe lo que ya cargó `loadPreventiveTabData`. Una dimensión sin valor lleva el rótulo
 * de la pantalla («Sin faena», «Sin mecánico»); una medida que no existe va vacía, nunca en cero.
 */

const PERCENT_FORMAT = "0.0"

export const PREVENTIVE_SHEET_NAMES = {
  byMonth: "Cumplimiento por mes",
  byWorksite: "Cumplimiento faena y mecánico",
  byPlate: "Cumplimiento por equipo",
  matrix: "Matriz de checklist",
  matrixChecks: "Pautas de la matriz",
} as const

export function complianceByMonthSheet(buckets: readonly ComplianceBucket[]): ReportSheet {
  return {
    worksheetName: PREVENTIVE_SHEET_NAMES.byMonth,
    headers: ["Mes", "Cumplimiento (%)", "Pautas"],
    rows: buckets.map((bucket) => [bucket.label, bucket.percent, bucket.checks]),
    columnFormats: { 1: PERCENT_FORMAT },
  }
}

export function complianceByWorksiteMechanicSheet(buckets: readonly ComplianceBucket[]): ReportSheet {
  return {
    worksheetName: PREVENTIVE_SHEET_NAMES.byWorksite,
    headers: ["Faena", "Mecánico", "Cumplimiento (%)", "Pautas"],
    rows: buckets.map((bucket) => [bucket.worksiteName ?? "Sin faena", bucket.mechanicLabel ?? "Sin mecánico", bucket.percent, bucket.checks]),
    columnFormats: { 2: PERCENT_FORMAT },
  }
}

/** «Cumplimiento por equipo»: en el orden de la pantalla (primero los equipos con más ítems sin hacer). */
export function complianceByPlateSheet(rows: readonly ComplianceByPlate[]): ReportSheet {
  return {
    worksheetName: PREVENTIVE_SHEET_NAMES.byPlate,
    headers: [
      "Patente", "Código", "Faena", "Niveles de pauta", "Cumplimiento (%)", "Pautas", "Sin hacer", "Última pauta",
      "Mecánico de la última pauta", "Fotos completas",
    ],
    rows: rows.map((row) => [
      row.plate || null,
      row.code || null,
      row.worksiteName ?? "Sin faena",
      row.levels.length > 0 ? row.levels.join(" · ") : null,
      row.percent,
      row.checks,
      row.notDone,
      row.lastDate ? excelPlainDate(row.lastDate) : null,
      row.lastMechanic ?? (row.lastDate ? "Sin mecánico" : null),
      photosText(row.withoutPhotos),
    ]),
    columnFormats: { 4: PERCENT_FORMAT, 7: EXCEL_DATE_FORMAT },
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
    worksheetName: PREVENTIVE_SHEET_NAMES.matrix,
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
    worksheetName: PREVENTIVE_SHEET_NAMES.matrixChecks,
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
export function preventiveNotes(unit: MantUnit, matrix: ChecklistMatrix, matrixLimit: number): string[] {
  const subject = unit === "km" ? "equipos por kilómetros" : "equipos por horas"
  const notes = [
    `Pautas de formularios hasta el ${formatDate(FORMS_LAST_COUNTED_DATE)} y registros de la plataforma desde el ${formatDate(FORMS_CUTOVER_DATE)}, sólo ${subject}.`,
    "Cumplimiento: el % de una pauta es realizados / (realizados + no realizados); «No aplica» no entra. El % de un mes, de una faena y mecánico o de un equipo es el promedio de los % de cada pauta, no el cociente de los totales. Los nombres de mecánico del histórico son texto libre.",
    "«Cumplimiento faena y mecánico» trae todas las combinaciones, la de menor cumplimiento primero (el gráfico, las 12 primeras).",
    "«Cumplimiento por equipo» va con los equipos que más ítems dejaron sin hacer primero; «Sin hacer» suma los ítems «no realizados» de todas sus pautas del período y «Fotos completas» dice «Todas» o cuántas pautas no traen las dos fotos (filtros y sticker).",
    `La matriz de checklist trae hasta ${matrixLimit} pautas con detalle por ítem, las más recientes (la pantalla muestra las últimas 8). «Pautas de la matriz» lleva el mecánico y las observaciones de cada una.`,
    "Las fotos no se exportan: de las pautas va la cantidad de fotos de la plataforma y los enlaces de respaldo del histórico.",
    "Una celda vacía es un dato que no existe, no un cero.",
    "Los filtros cruzados actúan como en la pantalla: cada hoja ignora la selección que ella misma emite.",
  ]
  if (matrix.withoutDetail > 0) {
    notes.push(`${matrix.withoutDetail} de las últimas pautas no traen detalle por ítem y no se incluyen como columna de la matriz.`)
  }
  return notes
}
