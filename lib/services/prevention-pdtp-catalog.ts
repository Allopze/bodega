import ExcelJS from "exceljs"

/**
 * Nombre de la hoja consolidada en el libro fuente RE-36/2026. Vive aqui, en el
 * adaptador, para que los servicios genericos de `lib/services/pdtp/**` no
 * repitan literales de hojas del documento 2026 (regla de Fase 2.3 del plan).
 */
export const PDTP_2026_GENERAL_SHEET_NAME = "PDTP GENERAL"

const OFFICIAL_SHEETS = [
  [PDTP_2026_GENERAL_SHEET_NAME, "pdtp_general"],
  ["CPHS", "cphs"],
  ["PRF Y Adm. de contrato", "prf_adm_contrato"],
  ["Sup, JT", "sup_jt"],
  ["PRF", "prf"],
  ["Adm. de contrato", "adm_contrato"],
  ["Subgerente operaciones y mant.", "subgerente"],
  ["Capacitación y Campañas ", "capacitacion"],
] as const

const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
] as const

export type PdtpSheetCode = typeof OFFICIAL_SHEETS[number][1]

export type PdtpWorkbook = ExcelJS.Workbook

export type PdtpObjective = {
  order: number
  name: string
  activityNumbers: number[]
}

export type PdtpScheduleCell = {
  month: number
  week: number
  plannedQuantity: number
  sourceColumn: string
}

export type PdtpImportedExecutionCell = {
  activityNumber: number
  month: number
  week: number
  executedQuantity: number
  sourceSheet: string
  sourceRow: number
  sourceColumn: string
  sourceCell: string
}

export type PdtpWorkbookMetadata = {
  title: string | null
  documentCode: string | null
  indicatorObjective: string | null
  indicatorType: string | null
  indicatorFormula: string | null
  indicatorTarget: number | null
  indicatorPeriodicity: string | null
  measurementOwner: string | null
  elaboratedByName: string | null
  elaboratedByTitle: string | null
  elaboratedAt: string | null
  approvedByName: string | null
  approvedByTitle: string | null
  approvedAt: string | null
  changeControl: Array<{ date: string | null; description: string }>
  roleLegend: Array<{ code: string; label: string }>
  scheduleLegend: string | null
}

export type PdtpCatalogActivity = {
  n: number
  objectiveOrder: number
  objective: string
  program: string
  activity: string
  responsibleDisplay: string
  responsibleSlugs: string[]
  sourceSheetRow: number
  schedule: PdtpScheduleCell[]
}

export type PdtpCatalog = {
  objectives: PdtpObjective[]
  activities: PdtpCatalogActivity[]
  sheetActivities: Record<PdtpSheetCode, number[]>
  importedExecutions?: PdtpImportedExecutionCell[]
  metadata?: PdtpWorkbookMetadata
  warnings?: string[]
}

type ActivityCandidate = {
  n: number
  activity: string
  program: string
  responsibleDisplay: string
  sourceSheetRow: number
  plannedStartIndex: number
}

export async function readPdtpWorkbook(filePath: string): Promise<PdtpWorkbook> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)
  return workbook
}

export function extractPdtpCatalogFromWorkbook(workbook: PdtpWorkbook): PdtpCatalog {
  const general = workbook.getWorksheet(PDTP_2026_GENERAL_SHEET_NAME)
  if (!general) throw new Error(`No se encontro la hoja ${PDTP_2026_GENERAL_SHEET_NAME} en el libro PDTP.`)
  validateGeneralScheduleStructure(general)

  const generalRows = sheetRows(general)
  const objectives: PdtpObjective[] = []
  const activities: PdtpCatalogActivity[] = []
  const importedExecutions: PdtpImportedExecutionCell[] = []
  const scheduleWarnings: string[] = []
  let currentObjective: PdtpObjective | null = null

  for (let index = 0; index < generalRows.length; index++) {
    const row = generalRows[index] ?? []
    const candidate = parseActivityRow(row, index + 1)
    if (!candidate) continue

    const objectiveCell = normalizeWhitespace(normalizeCell(row[0]))
    // Las celdas fusionadas (merged cells) en Excel hacen que SheetJS y
    // ExcelJS se comporten distinto: SheetJS solo reporta el valor en la
    // primera fila de la fusion; ExcelJS lo reporta en todas. Evitamos
    // objetivos duplicados comparando con el ultimo objetivo conocido.
    if (objectiveCell && !isNumericText(objectiveCell) && (!currentObjective || objectiveCell !== currentObjective.name)) {
      currentObjective = {
        order: objectives.length + 1,
        name: objectiveCell,
        activityNumbers: [],
      }
      objectives.push(currentObjective)
    }

    if (!currentObjective) {
      throw new Error(`Actividad PDTP ${candidate.n} no tiene objetivo asociado.`)
    }

    currentObjective.activityNumbers.push(candidate.n)
    activities.push({
      n: candidate.n,
      objectiveOrder: currentObjective.order,
      objective: currentObjective.name,
      activity: candidate.activity,
      program: candidate.program,
      responsibleDisplay: candidate.responsibleDisplay,
      responsibleSlugs: parseResponsibleSlugs(candidate.responsibleDisplay),
      sourceSheetRow: candidate.sourceSheetRow,
      schedule: extractSchedule(row, candidate.plannedStartIndex),
    })
    importedExecutions.push(...extractExecutedCells(row, candidate, general.name))
    scheduleWarnings.push(...inspectScheduleCells(row, candidate, general.name))
  }

  // Integridad estructural de la numeracion: estrictamente creciente, unica y
  // positiva. No se fija el conteo ni la contiguidad porque el programa vigente
  // puede tener huecos por actividades retiradas (p. ej. la quita total de 4 y 8
  // en 2026). Esto sigue detectando filas duplicadas, desordenadas o perdidas.
  const actual = activities.map((activity) => activity.n)
  const monotonicUnique = actual.every(
    (n, index) => Number.isInteger(n) && n >= 1 && (index === 0 || n > actual[index - 1]!),
  )
  if (actual.length === 0 || !monotonicUnique) {
    throw new Error(`Catalogo PDTP invalido: se esperaba numeracion de actividades estrictamente creciente y unica, y se obtuvo ${actual.join(",")}.`)
  }

  return {
    objectives,
    activities,
    sheetActivities: extractSheetMembership(workbook),
    importedExecutions,
    metadata: extractWorkbookMetadata(general),
    warnings: [...extractWorkbookWarnings(general), ...scheduleWarnings],
  }
}

export function parseResponsibleSlugs(display: string): string[] {
  const normalized = normalizeWhitespace(display)
  const compact = normalized.toLocaleLowerCase("es-CL")

  if (compact === "conductores, operadores y choferes") {
    return ["conductores_operadores_choferes"]
  }

  return normalized
    .split(",")
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLocaleLowerCase("es-CL")
      if (lower === "adm. de contrato") return "admin_contrato"
      if (lower === "sub. gerente operaciones") return "subgerente_operaciones"
      if (lower === "gerente legal y rrhh") return "gerente_legal_rrhh"
      if (lower === "jdpr") return "jdpr"
      if (lower === "prf") return "prf"
      if (lower === "sup") return "sup"
      if (lower === "jt") return "jt"
      if (lower === "cphs") return "cphs"
      if (lower === "jm") return "jm"
      return lower
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
    })
}

function extractSheetMembership(workbook: PdtpWorkbook): Record<PdtpSheetCode, number[]> {
  const membership = {} as Record<PdtpSheetCode, number[]>

  for (const [sheetName, code] of OFFICIAL_SHEETS) {
    const worksheet = workbook.getWorksheet(sheetName)
    if (!worksheet) throw new Error(`No se encontro la hoja ${sheetName} en el libro PDTP.`)

    const numbers: number[] = []
    for (const [index, row] of sheetRows(worksheet).entries()) {
      const candidate = parseActivityRow(row, index + 1)
      if (candidate) numbers.push(candidate.n)
    }
    membership[code] = numbers
  }

  return membership
}

function extractSchedule(row: unknown[], plannedStartIndex: number): PdtpScheduleCell[] {
  const schedule: PdtpScheduleCell[] = []

  for (let plannedIndex = plannedStartIndex; plannedIndex < row.length; plannedIndex += 2) {
    const quantity = numericValue(row[plannedIndex])
    if (quantity === null || quantity <= 0) continue

    const sequence = (plannedIndex - plannedStartIndex) / 2
    schedule.push({
      month: Math.floor(sequence / 4) + 1,
      week: (sequence % 4) + 1,
      plannedQuantity: quantity,
      sourceColumn: encodeColumn(plannedIndex),
    })
  }

  return schedule
}

function extractExecutedCells(
  row: unknown[],
  activity: ActivityCandidate,
  sourceSheet: string,
): PdtpImportedExecutionCell[] {
  const executions: PdtpImportedExecutionCell[] = []
  for (let executedIndex = activity.plannedStartIndex + 1; executedIndex < row.length; executedIndex += 2) {
    const quantity = numericValue(row[executedIndex])
    if (quantity === null || quantity <= 0) continue
    const sequence = (executedIndex - (activity.plannedStartIndex + 1)) / 2
    const sourceColumn = encodeColumn(executedIndex)
    executions.push({
      activityNumber: activity.n,
      month: Math.floor(sequence / 4) + 1,
      week: (sequence % 4) + 1,
      executedQuantity: quantity,
      sourceSheet,
      sourceRow: activity.sourceSheetRow,
      sourceColumn,
      sourceCell: `${sourceColumn}${activity.sourceSheetRow}`,
    })
  }
  return executions
}

function extractWorkbookMetadata(sheet: ExcelJS.Worksheet): PdtpWorkbookMetadata {
  const text = (address: string) => normalizeWhitespace(normalizeCell(sheet.getCell(address).value)) || null
  const afterLabel = (address: string, label: RegExp) => text(address)?.replace(label, "").trim() || null
  const dateFromLabel = (address: string) => afterLabel(address, /^fecha\s*:\s*/i)
  const indicatorTarget = numericValue(sheet.getCell("AP7").value)
  const changeDate = text("C119")
  const changeDescription = text("D119")
  const roleLegend = [123, 124, 125, 126, 127].flatMap((row) => {
    const code = normalizeWhitespace(normalizeCell(sheet.getCell(`B${row}`).value))
    const label = normalizeWhitespace(normalizeCell(sheet.getCell(`C${row}`).value))
    return code && label ? [{ code, label }] : []
  })

  return {
    title: text("A2"),
    documentCode: afterLabel("CJ2", /^c[oó]digo\s*:\s*/i),
    indicatorObjective: text("A7"),
    indicatorType: text("I7"),
    indicatorFormula: text("Z7"),
    indicatorTarget,
    indicatorPeriodicity: text("BD7"),
    measurementOwner: text("BT7"),
    elaboratedByName: text("C113"),
    elaboratedByTitle: afterLabel("C116", /^cargo\s*:\s*/i),
    elaboratedAt: dateFromLabel("C115"),
    approvedByName: text("E113"),
    approvedByTitle: afterLabel("E116", /^cargo\s*:\s*/i),
    approvedAt: dateFromLabel("E115"),
    changeControl: changeDescription ? [{ date: changeDate, description: changeDescription }] : [],
    roleLegend,
    scheduleLegend: text("C129"),
  }
}

function validateGeneralScheduleStructure(sheet: ExcelJS.Worksheet) {
  const firstColumn = 6 // F
  const pairs = 48
  for (let sequence = 0; sequence < pairs; sequence++) {
    const plannedColumn = firstColumn + sequence * 2
    const executedColumn = plannedColumn + 1
    const plannedLabel = normalizeWhitespace(normalizeCell(sheet.getRow(12).getCell(plannedColumn).value)).toLocaleUpperCase("es-CL")
    const executedLabel = normalizeWhitespace(normalizeCell(sheet.getRow(12).getCell(executedColumn).value)).toLocaleUpperCase("es-CL")
    if (plannedLabel !== "P" || executedLabel !== "E") {
      throw new Error(`Estructura PDTP alterada: se esperaba el par P/E en ${encodeColumn(plannedColumn - 1)}12:${encodeColumn(executedColumn - 1)}12.`)
    }
  }
}

function inspectScheduleCells(row: unknown[], activity: ActivityCandidate, sourceSheet: string): string[] {
  const warnings: string[] = []
  for (let offset = 0; offset < 96; offset++) {
    const index = activity.plannedStartIndex + offset
    const value = row[index]
    if (value && typeof value === "object" && "formula" in value && !("result" in value)) {
      warnings.push(`La fórmula de ${sourceSheet}!${encodeColumn(index)}${activity.sourceSheetRow} no tiene resultado evaluable.`)
      continue
    }
    const normalized = normalizeWhitespace(normalizeCell(value))
    if (!normalized) {
      if (value && typeof value === "object" && "formula" in value) {
        warnings.push(`La fórmula de ${sourceSheet}!${encodeColumn(index)}${activity.sourceSheetRow} no tiene resultado evaluable.`)
      }
      continue
    }
    const numeric = numericValue(value)
    if (numeric === null) {
      warnings.push(`La celda ${sourceSheet}!${encodeColumn(index)}${activity.sourceSheetRow} contiene un valor P/E desconocido: “${normalized.slice(0, 80)}”.`)
    } else if (numeric < 0) {
      warnings.push(`La celda ${sourceSheet}!${encodeColumn(index)}${activity.sourceSheetRow} contiene una cantidad negativa no importable.`)
    }
  }
  return warnings
}

function extractWorkbookWarnings(sheet: ExcelJS.Worksheet): string[] {
  const warnings: string[] = []
  if (!normalizeWhitespace(normalizeCell(sheet.getCell("Z7").value))) {
    warnings.push("La fórmula del indicador no tiene un valor legible en la celda Z7; debe reconciliarse antes de aprobar la migración.")
  }
  return warnings
}

function parseActivityRow(row: unknown[], sourceSheetRow: number): ActivityCandidate | null {
  const first = normalizeCell(row[0])
  const second = normalizeCell(row[1])

  if (isNumericText(first)) {
    return {
      n: Number(first),
      activity: normalizeWhitespace(normalizeCell(row[1])),
      program: normalizeWhitespace(normalizeCell(row[2])),
      responsibleDisplay: normalizeWhitespace(normalizeCell(row[3])),
      sourceSheetRow,
      plannedStartIndex: 4,
    }
  }

  if (isNumericText(second)) {
    return {
      n: Number(second),
      activity: normalizeWhitespace(normalizeCell(row[2])),
      program: normalizeWhitespace(normalizeCell(row[3])),
      responsibleDisplay: normalizeWhitespace(normalizeCell(row[4])),
      sourceSheetRow,
      plannedStartIndex: 5,
    }
  }

  return null
}

function sheetRows(worksheet: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = []

  // First pass: determine max column count across all rows
  let maxCol = 0
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    row.eachCell({ includeEmpty: true }, (_cell, colNumber) => {
      if (colNumber > maxCol) maxCol = colNumber
    })
  })

  if (maxCol === 0) return rows

  // Second pass: build rectangular array with consistent width
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const values: unknown[] = []
    for (let c = 1; c <= maxCol; c++) {
      const cell = row.getCell(c)
      values.push(cell.value ?? "")
    }
    rows.push(values)
  })

  return rows
}

function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "object") {
    // ExcelJS formula: { formula: "...", result: value }
    if ("result" in value) {
      const result = (value as { result: unknown }).result
      if (result !== null && result !== undefined) return String(result)
      return ""
    }
    // ExcelJS rich text: { richText: [{ text: "..." }] }
    if ("richText" in value && Array.isArray((value as { richText: Array<{ text: string }> }).richText)) {
      return (value as { richText: Array<{ text: string }> }).richText.map((r) => r.text).join("")
    }
    // ExcelJS hyperlink: { text: "display", hyperlink: "url" }
    if ("text" in value && typeof (value as { text: string }).text === "string") {
      return (value as { text: string }).text
    }
    // ExcelJS error: { error: "#REF!" }
    if ("error" in value) return String((value as { error: string }).error)
  }
  return String(value)
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function isNumericText(value: string): boolean {
  return /^\d+$/.test(value)
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  const text = normalizeCell(value)
  if (!text) return null
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

/** Convert 0-based column index to Excel column letter (0=A, 1=B, ..., 25=Z, 26=AA). */
function encodeColumn(colIndex: number): string {
  let n = colIndex
  let result = ""
  while (n >= 0) {
    result = String.fromCharCode((n % 26) + 65) + result
    n = Math.floor(n / 26) - 1
  }
  return result
}

export const pdtpMonthNames = MONTHS
