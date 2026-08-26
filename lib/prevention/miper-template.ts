/**
 * Vocabulario y utilidades ExcelJS compartidas entre el importador y el
 * exportador MIPER, derivadas de la plantilla real de la empresa (RE-04
 * IPER). Puro — sin BD, sin `db/schema`, testeable sin Postgres.
 *
 * Verificado con exceljs contra el archivo real
 * (`docs/SGI Chome_2026/Matrices/RE- 04 ... (MIPER) Biodiversa.xlsx`): 5
 * hojas, encabezado de RE-04 IPER en dos filas fusionadas (R12 grupo, R13
 * subcolumna), datos desde R14, una sola evaluación P×C por fila, y 24 filas
 * vacías preformateadas al final que cachean "REVISAR" en la columna de
 * clasificación aunque no tienen ningún dato.
 */

import type ExcelJS from "exceljs"

export const MIPER_SHEETS = {
  instructions: "Instructivo MIPER",
  iper: "RE-04 IPER",
  modifications: "Modificaciones",
  criteria: "Criterios de Evaluación IPER",
  program: "Programa de Trabajo",
} as const

/** `Instructivo MIPER` se ignora a propósito (§62-63 de la ficha): es un ejemplo de cómo llenar una fila, no datos. */
export const MIPER_IGNORED_SHEETS: readonly string[] = [MIPER_SHEETS.instructions]

export type IperField =
  | "number" | "activity" | "task" | "position" | "specificWorkplace"
  | "workersFemale" | "workersMale" | "workersOther" | "riskFactor" | "routine"
  | "hazard" | "risk" | "probableDamage" | "probability" | "consequence"
  | "magnitude" | "classification" | "controlMeasure" | "controlStatus"
  | "responsible" | "deadline"

function normalizeHeader(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g, " ")
}

/** Alias exactos de la plantilla real (con y sin el espacio final que traen algunas celdas del archivo original). */
export const IPER_COLUMN_ALIASES: Record<IperField, string[]> = {
  number: ["n°", "n", "nro", "num"],
  activity: ["actividad"],
  task: ["tarea"],
  position: ["puesto de trabajo", "puesto"],
  specificWorkplace: ["lugar de trabajo especifico", "lugar de trabajo"],
  workersFemale: ["f"],
  workersMale: ["m"],
  workersOther: ["otro"],
  riskFactor: ["factores de riesgo", "factor de riesgo"],
  routine: ["rutinaria /no rutinaria", "rutinaria/no rutinaria", "rutinaria / no rutinaria"],
  hazard: ["peligro"],
  risk: ["riesgo"],
  probableDamage: ["dano probable", "daño probable"],
  probability: ["probabilidad"],
  consequence: ["consecuencia"],
  magnitude: ["mr"],
  classification: ["clasificacion del riesgo", "clasificación del riesgo"],
  controlMeasure: ["medida de control"],
  controlStatus: ["esta controlado el riesgo", "está controlado el riesgo"],
  responsible: ["responsable"],
  deadline: ["plazos", "plazo"],
} as const

/** Mínimo para reconocer que una fila describe un riesgo (§11 de la ficha). */
export const IPER_REQUIRED_FIELDS: readonly IperField[] = ["activity", "task", "hazard", "risk", "probability", "consequence"]

/**
 * Todas las columnas de DATOS (todo menos N°, MR y clasificación). Es la
 * base de `isEmptyDataRow`: las 24 filas fantasma del archivo real tienen
 * TODO esto vacío pero conservan "REVISAR" cacheado en `classification` —
 * cortar por esa columna las contaría como riesgos.
 */
export const IPER_DATA_FIELDS: readonly IperField[] = (Object.keys(IPER_COLUMN_ALIASES) as IperField[])
  .filter((field) => field !== "number" && field !== "magnitude" && field !== "classification")

/** Busca una hoja por nombre canónico, tolerando mayúsculas/tildes/espacios. */
export function findSheet(workbook: ExcelJS.Workbook, canonicalName: string): ExcelJS.Worksheet | null {
  const target = normalizeHeader(canonicalName)
  return workbook.worksheets.find((sheet) => normalizeHeader(sheet.name) === target) ?? null
}

export interface HeaderLocation {
  /** Fila de encabezado (o la de grupo, si el encabezado es de dos filas). */
  groupRow: number
  /** Fila de subcolumna, si el encabezado ocupa dos filas fusionadas (R12/R13 del archivo real). */
  subRow: number | null
  firstDataRow: number
}

/**
 * Escanea buscando la primera fila que declare simultáneamente "actividad" y
 * "peligro" — no asume R12/R13 fijo. Ya hay evidencia de deriva de plantilla
 * entre faenas (la hoja `Modificaciones` falta en archivos más viejos), así
 * que una cabecera de documento con una fila de más correría todo hacia
 * abajo si la posición fuera fija.
 */
export function detectHeaderRows(sheet: ExcelJS.Worksheet, maxScan = 30): HeaderLocation | null {
  const limit = Math.min(maxScan, sheet.rowCount || maxScan)
  for (let rowNumber = 1; rowNumber <= limit; rowNumber++) {
    const texts = rowTexts(sheet, rowNumber)
    const hasActivity = texts.some((text) => normalizeHeader(text) === "actividad")
    const hasHazard = texts.some((text) => normalizeHeader(text) === "peligro")
    if (!hasActivity || !hasHazard) continue
    // ¿La fila siguiente aporta un alias que ésta no tiene (típicamente F/M/OTRO
    // de N° TRABAJADORES)? Entonces el encabezado ocupa dos filas fusionadas.
    const nextTexts = rowTexts(sheet, rowNumber + 1).map(normalizeHeader)
    const currentFields = new Set(matchedFields(texts))
    const nextFields = matchedFields(rowTexts(sheet, rowNumber + 1)).filter((field) => !currentFields.has(field))
    const isTwoRowHeader = nextFields.length > 0 && nextTexts.some((text) => text.length > 0)
    return isTwoRowHeader
      ? { groupRow: rowNumber, subRow: rowNumber + 1, firstDataRow: rowNumber + 2 }
      : { groupRow: rowNumber, subRow: null, firstDataRow: rowNumber + 1 }
  }
  return null
}

function rowTexts(sheet: ExcelJS.Worksheet, rowNumber: number): string[] {
  const row = sheet.getRow(rowNumber)
  const texts: string[] = []
  row.eachCell({ includeEmpty: false }, (cell) => texts.push(cellText(cell)))
  return texts
}

function matchedFields(texts: string[]): IperField[] {
  const normalized = texts.map(normalizeHeader)
  const fields: IperField[] = []
  for (const [field, aliases] of Object.entries(IPER_COLUMN_ALIASES) as Array<[IperField, string[]]>) {
    if (aliases.some((alias) => normalized.includes(alias))) fields.push(field)
  }
  return fields
}

/** Mapea columna → índice, combinando ambas filas si el encabezado es de dos filas. */
export function mapColumns(sheet: ExcelJS.Worksheet, header: HeaderLocation): Partial<Record<IperField, number>> {
  const map: Partial<Record<IperField, number>> = {}
  function scanRow(rowNumber: number) {
    const row = sheet.getRow(rowNumber)
    row.eachCell({ includeEmpty: false }, (cell, column) => {
      const text = normalizeHeader(cellText(cell))
      for (const [field, aliases] of Object.entries(IPER_COLUMN_ALIASES) as Array<[IperField, string[]]>) {
        if (map[field] === undefined && aliases.includes(text)) map[field] = column
      }
    })
  }
  scanRow(header.groupRow)
  if (header.subRow) scanRow(header.subRow)
  return map
}

/**
 * Lee una celda resolviendo `.master` para celdas fusionadas: sólo la ancla
 * de un merge tiene valor propio en ExcelJS — el resto devuelve `null`. Sin
 * esto, todo el bloque de cabecera del documento (D7/H7/S7/S8/D9/H9/M10/S9/S10,
 * fusionadas verticalmente en filas de 2) se leería vacío.
 */
export function readCell(sheet: ExcelJS.Worksheet, address: string): ExcelJS.CellValue {
  const cell = sheet.getCell(address)
  const anchor = cell.master ?? cell
  return anchor.value
}

/** Texto plano de una celda: resuelve fórmulas (usa `result`, nunca la fórmula), rich text y fechas. */
export function cellText(cell: ExcelJS.Cell | { value: ExcelJS.CellValue }): string {
  const value = cell.value
  if (value == null) return ""
  if (value instanceof Date) return value.toISOString()
  if (typeof value !== "object") return String(value).trim()
  if ("result" in value) return value.result == null ? "" : cellText({ value: value.result as ExcelJS.CellValue })
  if ("text" in value && typeof value.text === "string") return value.text.trim()
  if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((item) => item.text).join("").trim()
  return ""
}

/**
 * Una fila es un riesgo real sólo si al menos una columna de DATOS trae
 * contenido — nunca si sólo la columna de clasificación viene poblada (las
 * 24 filas fantasma del archivo real cachean "REVISAR" ahí sin tener ningún
 * dato).
 */
export function isEmptyDataRow(row: ExcelJS.Row, columns: Partial<Record<IperField, number>>): boolean {
  for (const field of IPER_DATA_FIELDS) {
    const column = columns[field]
    if (column === undefined) continue
    if (cellText(row.getCell(column)).length > 0) return false
  }
  return true
}

/** Direcciones fijas del bloque de cabecera del documento (RE-04 IPER, R7-R10). */
export const IPER_HEADER_CELLS = {
  docCode: "D7",
  elaboratedAt: "H7",
  updatedAt: "S7",
  elaboratedBy: "S8",
  rut: "D9",
  legalRep: "H9",
  worksiteName: "M10",
  reviewedBy: "S9",
  approvedByRole: "S10",
} as const
