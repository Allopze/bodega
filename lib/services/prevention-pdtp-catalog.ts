import * as XLSX from "xlsx"

const OFFICIAL_SHEETS = [
  ["PDTP GENERAL", "pdtp_general"],
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

export type PdtpWorkbook = XLSX.WorkBook

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
}

type ActivityCandidate = {
  n: number
  activity: string
  program: string
  responsibleDisplay: string
  sourceSheetRow: number
  plannedStartIndex: number
}

export function readPdtpWorkbook(filePath: string): PdtpWorkbook {
  return XLSX.readFile(filePath, { cellDates: true, cellFormula: true })
}

export function extractPdtpCatalogFromWorkbook(workbook: PdtpWorkbook): PdtpCatalog {
  const general = workbook.Sheets["PDTP GENERAL"]
  if (!general) throw new Error("No se encontro la hoja PDTP GENERAL en el libro PDTP.")

  const generalRows = sheetRows(general)
  const objectives: PdtpObjective[] = []
  const activities: PdtpCatalogActivity[] = []
  let currentObjective: PdtpObjective | null = null

  for (let index = 0; index < generalRows.length; index++) {
    const row = generalRows[index] ?? []
    const candidate = parseActivityRow(row, index + 1)
    if (!candidate) continue

    const objectiveCell = normalizeCell(row[0])
    if (objectiveCell && !isNumericText(objectiveCell)) {
      currentObjective = {
        order: objectives.length + 1,
        name: normalizeWhitespace(objectiveCell),
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
  }

  const expected = Array.from({ length: 89 }, (_, index) => index + 1)
  const actual = activities.map((activity) => activity.n)
  if (actual.length !== 89 || actual.some((n, index) => n !== expected[index])) {
    throw new Error(`Catalogo PDTP invalido: se esperaban actividades 1-89 y se obtuvo ${actual.join(",")}.`)
  }

  return {
    objectives,
    activities,
    sheetActivities: extractSheetMembership(workbook),
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
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) throw new Error(`No se encontro la hoja ${sheetName} en el libro PDTP.`)

    const numbers: number[] = []
    for (const [index, row] of sheetRows(sheet).entries()) {
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
      sourceColumn: XLSX.utils.encode_col(plannedIndex),
    })
  }

  return schedule
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

function sheetRows(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" }) as unknown[][]
}

function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text
    if ("result" in value) return String(value.result ?? "")
    if ("v" in value) return String(value.v ?? "")
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

export const pdtpMonthNames = MONTHS
