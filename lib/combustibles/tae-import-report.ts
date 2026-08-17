import ExcelJS from "exceljs"
import { levenshtein } from "@/lib/levenshtein"
import type { ParsedTaeLegacyRow, TaeLegacyImportError } from "./tae-import"

/**
 * Reporte de mapeo sugerido para el histórico TAE (Fase 5, método aprobado en
 * Fase 0 el 2026-07-12): fuzzy-match de equipos/conductores/supervisores contra
 * los catálogos actuales, con nivel de confianza, para revisión y aprobación
 * manual fila por fila. No escribe nada en la base de datos.
 */

/** Alias de faena aprobados en Fase 0 (2026-07-12): nombre del Excel → nombre de la faena en el catálogo. */
export const TAE_WORKSITE_ALIASES: Record<string, string> = {
  "SANTA FE": "Santa Fe Gruas",
  "CHOLGUAN 1": "Cholguan",
  "MININCO": "Pacifico", // corregido en Fase 0: alias de la faena existente, no una faena nueva
  "MASISA": "Masisa",
}

export type MatchConfidence = "exacta" | "probable" | "posible" | "sin_match"

export interface VehicleCatalogEntry {
  id: string
  code: string | null
  plate: string
  worksiteName: string
}

export interface WorkerCatalogEntry {
  id: string
  name: string
  worksiteId: string
  worksiteName: string
}

export interface WorksiteMatch {
  legacyName: string
  occurrences: number
  resolvedName: string
  worksiteId: string | null
}

export interface EquipmentMatch {
  legacyCode: string
  occurrences: number
  worksites: string
  matchedVehicleId: string | null
  matchedCode: string | null
  matchedPlate: string | null
  matchedWorksite: string | null
  confidence: MatchConfidence
  score: number
}

export interface WorkerMatch {
  legacyName: string
  occurrences: number
  worksites: string
  matchedWorkerId: string | null
  matchedName: string | null
  matchedWorksite: string | null
  sameWorksite: boolean
  confidence: MatchConfidence
  score: number
}

export interface SealContinuityObservation {
  equipmentCode: string
  previousRowIndex: number
  nextRowIndex: number
  previousInstalledSeal: string
  nextRemovedSeal: string
}

export interface TaeImportReportData {
  summary: {
    totalRows: number
    validRows: number
    errorRows: number
    totalLiters: number
    generatedAt: string
  }
  worksites: WorksiteMatch[]
  equipment: EquipmentMatch[]
  drivers: WorkerMatch[]
  supervisors: WorkerMatch[]
  errors: TaeLegacyImportError[]
  sealObservations: SealContinuityObservation[]
  missingReadingRows: Array<{ rowIndex: number; equipmentCode: string; meterRaw: string | null }>
  missingSealRows: Array<{ rowIndex: number; equipmentCode: string; removedSealNumber: string | null; installedSealNumber: string | null }>
}

export function normalizeCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "")
}

export function normalizeName(value: string): string {
  return value
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** Similaridad por edición de caracteres, útil para códigos cortos con errores de tipeo. */
function codeSimilarity(a: string, b: string): number {
  const normA = normalizeCode(a)
  const normB = normalizeCode(b)
  if (!normA || !normB) return 0
  return 1 - levenshtein(normA, normB) / Math.max(normA.length, normB.length)
}

/** Similaridad por conjunto de palabras, robusta a orden y nombres intermedios. */
function nameSimilarity(a: string, b: string): number {
  const tokensA = new Set(normalizeName(a).split(" ").filter(Boolean))
  const tokensB = new Set(normalizeName(b).split(" ").filter(Boolean))
  if (!tokensA.size || !tokensB.size) return 0
  let intersection = 0
  for (const token of tokensA) if (tokensB.has(token)) intersection++
  const union = tokensA.size + tokensB.size - intersection
  return union === 0 ? 0 : intersection / union
}

function confidenceFor(score: number): MatchConfidence {
  if (score >= 0.999) return "exacta"
  if (score >= 0.7) return "probable"
  if (score >= 0.4) return "posible"
  return "sin_match"
}

function groupByOccurrence<T>(rows: T[], key: (row: T) => string, worksiteOf: (row: T) => string): Map<string, { count: number; worksites: Set<string> }> {
  const groups = new Map<string, { count: number; worksites: Set<string> }>()
  for (const row of rows) {
    const value = key(row)
    if (!value) continue
    const entry = groups.get(value) ?? { count: 0, worksites: new Set<string>() }
    entry.count++
    entry.worksites.add(worksiteOf(row))
    groups.set(value, entry)
  }
  return groups
}

function matchEquipment(code: string, vehicles: VehicleCatalogEntry[]): { match: VehicleCatalogEntry | null; score: number } {
  let best: VehicleCatalogEntry | null = null
  let bestScore = 0
  for (const vehicle of vehicles) {
    const candidates = [vehicle.code, vehicle.plate].filter((value): value is string => Boolean(value))
    for (const candidate of candidates) {
      const score = codeSimilarity(code, candidate)
      if (score > bestScore) { bestScore = score; best = vehicle }
    }
  }
  return { match: bestScore >= 0.4 ? best : null, score: bestScore }
}

function matchWorker(name: string, workersCatalog: WorkerCatalogEntry[], preferredWorksiteName: string | null): { match: WorkerCatalogEntry | null; score: number } {
  const inWorksite = preferredWorksiteName ? workersCatalog.filter((worker) => worker.worksiteName === preferredWorksiteName) : []
  const pools = inWorksite.length ? [inWorksite, workersCatalog] : [workersCatalog]
  for (const pool of pools) {
    let best: WorkerCatalogEntry | null = null
    let bestScore = 0
    for (const worker of pool) {
      const score = nameSimilarity(name, worker.name)
      if (score > bestScore) { bestScore = score; best = worker }
    }
    if (bestScore >= 0.4) return { match: best, score: bestScore }
  }
  return { match: null, score: 0 }
}

/** Continuidad de sello por equipo: el sello instalado de una carga debería ser el retirado de la siguiente. */
function computeSealObservations(rows: ParsedTaeLegacyRow[]): SealContinuityObservation[] {
  const byEquipment = new Map<string, ParsedTaeLegacyRow[]>()
  for (const row of rows) {
    const list = byEquipment.get(row.equipmentCode) ?? []
    list.push(row)
    byEquipment.set(row.equipmentCode, list)
  }
  const observations: SealContinuityObservation[] = []
  for (const [equipmentCode, equipmentRows] of byEquipment) {
    const sorted = [...equipmentRows].sort((a, b) => a.loadedAt.localeCompare(b.loadedAt))
    for (let i = 0; i < sorted.length - 1; i++) {
      const previous = sorted[i]!
      const next = sorted[i + 1]!
      if (previous.installedSealNumber && next.removedSealNumber && previous.installedSealNumber !== next.removedSealNumber) {
        observations.push({
          equipmentCode,
          previousRowIndex: previous.rowIndex,
          nextRowIndex: next.rowIndex,
          previousInstalledSeal: previous.installedSealNumber,
          nextRemovedSeal: next.removedSealNumber,
        })
      }
    }
  }
  return observations
}

export function buildTaeImportReport(input: {
  rows: ParsedTaeLegacyRow[]
  errors: TaeLegacyImportError[]
  worksites: Array<{ id: string; name: string }>
  vehicles: VehicleCatalogEntry[]
  workers: WorkerCatalogEntry[]
}): TaeImportReportData {
  const { rows, errors, worksites, vehicles, workers } = input
  const worksiteByName = new Map(worksites.map((worksite) => [worksite.name.trim().toUpperCase(), worksite]))

  const worksiteGroups = groupByOccurrence(rows, (row) => row.worksiteName, (row) => row.worksiteName)
  const worksiteMatches: WorksiteMatch[] = [...worksiteGroups.entries()].map(([legacyName, entry]) => {
    const resolvedName = TAE_WORKSITE_ALIASES[legacyName] ?? legacyName
    const worksite = worksiteByName.get(resolvedName.trim().toUpperCase())
    return { legacyName, occurrences: entry.count, resolvedName, worksiteId: worksite?.id ?? null }
  }).sort((a, b) => b.occurrences - a.occurrences)

  const resolvedWorksiteByLegacyName = new Map(worksiteMatches.map((match) => [match.legacyName, match.resolvedName]))

  const equipmentGroups = groupByOccurrence(rows, (row) => row.equipmentCode, (row) => row.worksiteName)
  const equipment: EquipmentMatch[] = [...equipmentGroups.entries()].map(([legacyCode, entry]) => {
    const { match, score } = matchEquipment(legacyCode, vehicles)
    return {
      legacyCode,
      occurrences: entry.count,
      worksites: [...entry.worksites].join(", "),
      matchedVehicleId: match?.id ?? null,
      matchedCode: match?.code ?? null,
      matchedPlate: match?.plate ?? null,
      matchedWorksite: match?.worksiteName ?? null,
      confidence: confidenceFor(score),
      score: Math.round(score * 100) / 100,
    }
  }).sort((a, b) => b.occurrences - a.occurrences)

  function matchPeople(pickName: (row: ParsedTaeLegacyRow) => string): WorkerMatch[] {
    const groups = groupByOccurrence(rows, pickName, (row) => row.worksiteName)
    return [...groups.entries()].map(([legacyName, entry]) => {
      const preferredWorksite = resolvedWorksiteByLegacyName.get([...entry.worksites][0] ?? "") ?? null
      const { match, score } = matchWorker(legacyName, workers, preferredWorksite)
      return {
        legacyName,
        occurrences: entry.count,
        worksites: [...entry.worksites].join(", "),
        matchedWorkerId: match?.id ?? null,
        matchedName: match?.name ?? null,
        matchedWorksite: match?.worksiteName ?? null,
        sameWorksite: Boolean(match && preferredWorksite && match.worksiteName === preferredWorksite),
        confidence: confidenceFor(score),
        score: Math.round(score * 100) / 100,
      }
    }).sort((a, b) => b.occurrences - a.occurrences)
  }

  const drivers = matchPeople((row) => row.driverName)
  const supervisors = matchPeople((row) => row.supervisorName)

  const missingReadingRows = rows
    .filter((row) => row.meterReading == null && row.meterRaw)
    .map((row) => ({ rowIndex: row.rowIndex, equipmentCode: row.equipmentCode, meterRaw: row.meterRaw }))

  const missingSealRows = rows
    .filter((row) => !row.removedSealNumber || !row.installedSealNumber)
    .map((row) => ({ rowIndex: row.rowIndex, equipmentCode: row.equipmentCode, removedSealNumber: row.removedSealNumber, installedSealNumber: row.installedSealNumber }))

  return {
    summary: {
      totalRows: rows.length + errors.length,
      validRows: rows.length,
      errorRows: errors.length,
      totalLiters: Math.round(rows.reduce((sum, row) => sum + row.liters, 0) * 1000) / 1000,
      generatedAt: new Date().toISOString(),
    },
    worksites: worksiteMatches,
    equipment,
    drivers,
    supervisors,
    errors,
    sealObservations: computeSealObservations(rows),
    missingReadingRows,
    missingSealRows,
  }
}

export async function renderTaeImportReportXlsx(report: TaeImportReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = "Plataforma Chome"
  wb.created = new Date()

  function addSheet(name: string, headers: string[], rows: Array<Array<string | number>>) {
    const ws = wb.addWorksheet(name)
    ws.addRow(headers)
    for (const row of rows) ws.addRow(row)
    const headerRow = ws.getRow(1)
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } }
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } }
    ws.columns.forEach((column, index) => {
      let width = Math.max(12, (headers[index] ?? "").length + 2)
      column.eachCell?.({ includeEmpty: true }, (cell) => { width = Math.max(width, String(cell.value ?? "").length + 2) })
      column.width = Math.min(width, 42)
    })
    ws.views = [{ state: "frozen", ySplit: 1 }]
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } }
    return ws
  }

  addSheet("Resumen", ["Métrica", "Valor"], [
    ["Filas totales en el Excel", report.summary.totalRows],
    ["Filas válidas (parseadas)", report.summary.validRows],
    ["Filas con error (sin destino)", report.summary.errorRows],
    ["Litros válidos totales", report.summary.totalLiters],
    ["Faenas distintas", report.worksites.length],
    ["Equipos distintos", report.equipment.length],
    ["Equipos sin match", report.equipment.filter((item) => item.confidence === "sin_match").length],
    ["Conductores distintos", report.drivers.length],
    ["Conductores sin match", report.drivers.filter((item) => item.confidence === "sin_match").length],
    ["Supervisores/líderes distintos", report.supervisors.length],
    ["Supervisores sin match", report.supervisors.filter((item) => item.confidence === "sin_match").length],
    ["Observaciones de continuidad de sello", report.sealObservations.length],
    ["Filas con lectura no numérica", report.missingReadingRows.length],
    ["Filas con sello faltante", report.missingSealRows.length],
    ["Generado", report.summary.generatedAt],
  ])

  addSheet("Faenas", ["Faena en Excel", "Filas", "Alias resuelto", "Faena encontrada"], report.worksites.map((item) =>
    [item.legacyName, item.occurrences, item.resolvedName, item.worksiteId ? "Sí" : "NO ENCONTRADA"]))

  addSheet("Equipos", ["Código en Excel", "Filas", "Faenas", "Confianza", "Score", "Código sugerido", "Patente sugerida", "Faena del equipo"], report.equipment.map((item) =>
    [item.legacyCode, item.occurrences, item.worksites, item.confidence, item.score, item.matchedCode ?? "", item.matchedPlate ?? "", item.matchedWorksite ?? ""]))

  function peopleRows(items: WorkerMatch[]) {
    return items.map((item) => [item.legacyName, item.occurrences, item.worksites, item.confidence, item.score, item.matchedName ?? "", item.matchedWorksite ?? "", item.sameWorksite ? "Sí" : "No"])
  }
  addSheet("Conductores", ["Nombre en Excel", "Filas", "Faenas", "Confianza", "Score", "Trabajador sugerido", "Faena del trabajador", "Misma faena"], peopleRows(report.drivers))
  addSheet("Supervisores", ["Nombre en Excel", "Filas", "Faenas", "Confianza", "Score", "Trabajador sugerido", "Faena del trabajador", "Misma faena"], peopleRows(report.supervisors))

  addSheet("Errores", ["Fila", "Campo", "Mensaje"], report.errors.map((error) => [error.rowIndex, error.field, error.message]))

  addSheet("Continuidad de sello", ["Equipo", "Fila anterior", "Fila siguiente", "Sello instalado (anterior)", "Sello retirado (siguiente)"], report.sealObservations.map((item) =>
    [item.equipmentCode, item.previousRowIndex, item.nextRowIndex, item.previousInstalledSeal, item.nextRemovedSeal]))

  addSheet("Lecturas observadas", ["Fila", "Equipo", "Valor original"], report.missingReadingRows.map((item) => [item.rowIndex, item.equipmentCode, item.meterRaw ?? ""]))

  addSheet("Sellos faltantes", ["Fila", "Equipo", "Sello retirado", "Sello instalado"], report.missingSealRows.map((item) =>
    [item.rowIndex, item.equipmentCode, item.removedSealNumber ?? "(vacío)", item.installedSealNumber ?? "(vacío)"]))

  const buffer = await wb.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
