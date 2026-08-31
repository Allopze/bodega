import ExcelJS from "exceljs"
import {
  normalizeCellValue,
  normKey,
  parseSheetDate,
  plateMatchKey,
} from "@/lib/combustibles/xlsx-utils"

export type EmergencyImportDecision = "create" | "update" | "unchanged" | "conflict"
export type EmergencyCoverageState = "covered" | "uncovered" | "attention" | "incomplete"
export type EmergencyResourceEventType = "used" | "service_requested" | "service_completed" | "reassigned" | "retired" | "imported"

export interface EmergencyImportVehicle {
  id: string
  worksiteId: string
  plate: string
  brand: string | null
  category: string | null
}

export interface EmergencyImportExistingResource {
  id: string
  worksiteId: string
  assetCode: string | null
  agent: string | null
  capacity: number | null
  capacityUnit: string | null
  lastMaintenanceAt: string | null
  expiresAt: string | null
  status: "operational" | "needs_maintenance" | "out_of_service"
}

export interface EmergencyImportExistingPlacement {
  resourceId: string
  vehicleId: string | null
  fixedLocation: string | null
}

export interface EmergencyImportContext {
  worksiteId: string
  vehicles: readonly EmergencyImportVehicle[]
  existingResources: readonly EmergencyImportExistingResource[]
  existingPlacements: readonly EmergencyImportExistingPlacement[]
}

export interface EmergencyImportPreviewRow {
  line: number
  decision: EmergencyImportDecision
  assetCode: string
  agent: string
  capacity: number
  capacityUnit: string
  lastMaintenanceAt: string | null
  expiresAt: string | null
  status: "operational" | "needs_maintenance" | "out_of_service"
  eventType: "used" | "retired" | "imported"
  placementKind: "vehicle" | "fixed"
  vehicleId: string | null
  plate: string | null
  fixedLocation: string | null
  resourceId: string | null
  warnings: string[]
  error: string | null
}

export interface EmergencyImportPreview {
  headerLine: number | null
  rows: EmergencyImportPreviewRow[]
  conflicts: Array<{ line: number; message: string }>
  warnings: Array<{ line: number; message: string }>
  canConfirm: boolean
  counts: Record<EmergencyImportDecision, number>
}

const HEADERS = {
  assetCode: ["ID extintor", "Código extintor", "Código"],
  agent: ["Agente", "Agente extintor"],
  capacity: ["Capacidad", "Peso", "Peso kg"],
  lastMaintenanceAt: ["Última mantención", "Fecha recarga", "Última recarga"],
  expiresAt: ["Próximo vencimiento", "Vencimiento"],
  plate: ["Patente"],
  category: ["Categoría", "Tipo de punto"],
  location: ["Ubicación", "Lugar"],
  technicalStatus: ["Estado técnico", "Estado"],
} as const

const REQUIRED_HEADER_GROUPS = [HEADERS.assetCode, HEADERS.agent, HEADERS.capacity, HEADERS.location] as const

function normalizedHeader(value: unknown) {
  return normKey(String(normalizeCellValue(value as ExcelJS.CellValue) ?? ""))
}

function findHeaderLine(sheet: ExcelJS.Worksheet): number | null {
  const max = Math.min(25, sheet.rowCount)
  for (let rowNumber = 1; rowNumber <= max; rowNumber += 1) {
    const seen = new Set<string>()
    sheet.getRow(rowNumber).eachCell({ includeEmpty: true }, (cell) => {
      const header = normalizedHeader(cell.value)
      if (header) seen.add(header)
    })
    if (REQUIRED_HEADER_GROUPS.every((aliases) => aliases.some((alias) => seen.has(normKey(alias))))) return rowNumber
  }
  return null
}

function headerColumns(sheet: ExcelJS.Worksheet, headerLine: number) {
  const columns = new Map<string, number>()
  sheet.getRow(headerLine).eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    const header = normalizedHeader(cell.value)
    if (header) columns.set(header, columnNumber)
  })
  return columns
}

function valueFor(sheet: ExcelJS.Worksheet, line: number, columns: Map<string, number>, aliases: readonly string[]) {
  const column = aliases.map((alias) => columns.get(normKey(alias))).find((candidate) => candidate !== undefined)
  if (!column) return null
  return normalizeCellValue(sheet.getRow(line).getCell(column).value)
}

function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).replace(/\s+/g, " ").trim()
  return text || null
}

function normalizeAssetCode(value: unknown) {
  return (cleanText(value) ?? "").toUpperCase().replace(/\s+/g, "")
}

function normalizeAgent(value: unknown) {
  return (cleanText(value) ?? "").toUpperCase().replace(/[.\s-]+/g, "")
}

function parseCapacity(value: unknown): { capacity: number; unit: string } | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return { capacity: value, unit: "kg" }
  const text = cleanText(value)?.toLowerCase().replace(",", ".")
  if (!text) return null
  const match = /^(\d+(?:\.\d+)?)\s*(kg|kgs?|kilogramos?|l|lt|lts?|litros?)?$/.exec(text)
  if (!match) return null
  const capacity = Number(match[1])
  if (!Number.isFinite(capacity) || capacity <= 0) return null
  const rawUnit = match[2] ?? "kg"
  return { capacity, unit: rawUnit.startsWith("l") ? "l" : "kg" }
}

function parseRequiredDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null
  return parseSheetDate(value)
}

function normalizedLocation(value: unknown) {
  return cleanText(value)?.replace(/\s+/g, " ") ?? null
}

function sameNullableText(left: string | null, right: string | null) {
  return (left ?? "").trim().toLocaleLowerCase("es-CL") === (right ?? "").trim().toLocaleLowerCase("es-CL")
}

function placementKindFor(category: string, rawPlate: string | null): "vehicle" | "fixed" {
  const fixedWords = ["taller", "bodega", "oficina", "planta", "instalacion", "ubicacion fija"]
  if (fixedWords.some((word) => category.includes(word))) return "fixed"
  const vehicleWords = ["vehiculo", "camion", "tracto", "camioneta", "furgon", "bus", "maquinaria"]
  if (vehicleWords.some((word) => category.includes(word))) return "vehicle"
  const compactPlate = rawPlate ? plateMatchKey(rawPlate) : ""
  return compactPlate.length >= 4 && compactPlate.length <= 7 && /\d/.test(compactPlate) ? "vehicle" : "fixed"
}

function decisionFor(
  candidate: Omit<EmergencyImportPreviewRow, "decision" | "warnings" | "error">,
  context: EmergencyImportContext,
): EmergencyImportDecision {
  const existing = context.existingResources.find((resource) => resource.assetCode?.toUpperCase() === candidate.assetCode)
  if (!existing) return "create"
  const placement = context.existingPlacements.find((item) => item.resourceId === existing.id)
  const same = existing.agent === candidate.agent
    && existing.capacity === candidate.capacity
    && existing.capacityUnit === candidate.capacityUnit
    && existing.lastMaintenanceAt === candidate.lastMaintenanceAt
    && existing.expiresAt === candidate.expiresAt
    && existing.status === candidate.status
    && (placement?.vehicleId ?? null) === candidate.vehicleId
    && sameNullableText(placement?.fixedLocation ?? null, candidate.fixedLocation)
  return same ? "unchanged" : "update"
}

/**
 * Adapter del padrón real de extintores. Sólo interpreta y reconcilia: no
 * persiste ni crea vehículos, por lo que el preview siempre es seguro.
 */
export async function buildEmergencyInventoryPreview(
  fileBuffer: ArrayBuffer | Buffer,
  context: EmergencyImportContext,
): Promise<EmergencyImportPreview> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(fileBuffer as never)
  } catch {
    const message = "Archivo Excel inválido o corrupto."
    return { headerLine: null, rows: [], conflicts: [{ line: 0, message }], warnings: [], canConfirm: false, counts: { create: 0, update: 0, unchanged: 0, conflict: 1 } }
  }
  const sheet = workbook.worksheets[0]
  const headerLine = sheet ? findHeaderLine(sheet) : null
  if (!sheet || !headerLine) {
    const message = "No se encontró el encabezado del inventario en las primeras 25 filas."
    return { headerLine: null, rows: [], conflicts: [{ line: 0, message }], warnings: [], canConfirm: false, counts: { create: 0, update: 0, unchanged: 0, conflict: 1 } }
  }

  const columns = headerColumns(sheet, headerLine)
  const rows: EmergencyImportPreviewRow[] = []
  const seenCodes = new Set<string>()

  for (let line = headerLine + 1; line <= sheet.rowCount; line += 1) {
    const assetCode = normalizeAssetCode(valueFor(sheet, line, columns, HEADERS.assetCode))
    const rawLocation = valueFor(sheet, line, columns, HEADERS.location)
    const rawPlate = cleanText(valueFor(sheet, line, columns, HEADERS.plate))
    const rawAgent = valueFor(sheet, line, columns, HEADERS.agent)
    const rawCapacity = valueFor(sheet, line, columns, HEADERS.capacity)
    if (!assetCode && !rawLocation && !rawPlate && !cleanText(rawAgent) && !cleanText(rawCapacity)) continue

    const errors: string[] = []
    if (!assetCode) errors.push("Falta ID extintor.")
    if (assetCode && seenCodes.has(assetCode)) errors.push(`El ID ${assetCode} está repetido en el archivo.`)
    if (assetCode) seenCodes.add(assetCode)
    const agent = normalizeAgent(rawAgent)
    if (!agent) errors.push("Falta agente.")
    const parsedCapacity = parseCapacity(rawCapacity)
    if (!parsedCapacity) errors.push("Capacidad inválida.")
    const lastMaintenanceAt = parseRequiredDate(valueFor(sheet, line, columns, HEADERS.lastMaintenanceAt))
    const expiresAt = parseRequiredDate(valueFor(sheet, line, columns, HEADERS.expiresAt))
    if (valueFor(sheet, line, columns, HEADERS.lastMaintenanceAt) && !lastMaintenanceAt) errors.push("Fecha de mantención inválida.")
    if (valueFor(sheet, line, columns, HEADERS.expiresAt) && !expiresAt) errors.push("Próximo vencimiento inválido.")

    const category = cleanText(valueFor(sheet, line, columns, HEADERS.category))?.toLocaleLowerCase("es-CL") ?? ""
    const placementKind = placementKindFor(category, rawPlate)
    const fixedLocation = placementKind === "fixed" ? normalizedLocation(rawLocation) : null
    if (placementKind === "fixed" && !fixedLocation) errors.push("Falta ubicación fija.")

    let vehicleId: string | null = null
    if (placementKind === "vehicle") {
      if (!rawPlate) {
        errors.push("El punto de vehículo no tiene patente.")
      } else {
        const matches = context.vehicles.filter((vehicle) =>
          vehicle.worksiteId === context.worksiteId && plateMatchKey(vehicle.plate) === plateMatchKey(rawPlate),
        )
        if (matches.length !== 1) {
          errors.push(matches.length === 0
            ? `La patente ${rawPlate} no existe en Flota para esta faena.`
            : `La patente ${rawPlate} coincide con más de un vehículo de la faena.`)
        } else {
          vehicleId = matches[0]!.id
        }
      }
    }

    const existingResourceId = context.existingResources.find((resource) => resource.assetCode?.toUpperCase() === assetCode)?.id ?? null
    const occupiedTarget = context.existingPlacements.find((placement) => {
      if (placement.resourceId === existingResourceId) return false
      if (placementKind === "vehicle") return Boolean(vehicleId) && placement.vehicleId === vehicleId
      return sameNullableText(placement.fixedLocation, fixedLocation)
    })
    if (occupiedTarget) errors.push("El punto requerido ya está cubierto por otro activo.")

    const technicalStatus = cleanText(valueFor(sheet, line, columns, HEADERS.technicalStatus))?.toUpperCase() ?? ""
    const used = technicalStatus.includes("PERCUTADO") || technicalStatus.includes("UTILIZADO")
    const retired = technicalStatus.includes("FUERA DE SERVICIO") || technicalStatus.includes("DADO DE BAJA")
    const needsMaintenance = used || technicalStatus.includes("MANTEN") || technicalStatus.includes("RECARGA")
    const base = {
      line,
      assetCode,
      agent,
      capacity: parsedCapacity?.capacity ?? 0,
      capacityUnit: parsedCapacity?.unit ?? "",
      lastMaintenanceAt,
      expiresAt,
      status: retired ? "out_of_service" as const : needsMaintenance ? "needs_maintenance" as const : "operational" as const,
      eventType: retired ? "retired" as const : used ? "used" as const : "imported" as const,
      placementKind,
      vehicleId,
      plate: placementKind === "vehicle" ? rawPlate : null,
      fixedLocation,
      resourceId: existingResourceId,
    }
    const decision = errors.length > 0 ? "conflict" : decisionFor(base, context)
    rows.push({ ...base, decision, warnings: [], error: errors.join(" ") || null })
  }

  const conflicts = rows.filter((row) => row.decision === "conflict").map((row) => ({ line: row.line, message: row.error ?? "Conflicto sin resolver." }))
  const warnings = rows.flatMap((row) => row.warnings.map((message) => ({ line: row.line, message })))
  const counts = rows.reduce<Record<EmergencyImportDecision, number>>((total, row) => {
    total[row.decision] += 1
    return total
  }, { create: 0, update: 0, unchanged: 0, conflict: 0 })
  return { headerLine, rows, conflicts, warnings, canConfirm: rows.length > 0 && conflicts.length === 0, counts }
}

export interface EmergencyCoverageInput {
  today: string
  placements: ReadonlyArray<{ id: string; isActive: boolean; requiredTypeId: string | null }>
  assignments: ReadonlyArray<{ placementId: string; resourceId: string; active: boolean }>
  resources: ReadonlyArray<{
    id: string
    typeId: string | null
    status: "operational" | "needs_maintenance" | "out_of_service"
    expiresAt: string | null
    nextInspectionAt: string | null
  }>
}

export interface EmergencyCoverageRow {
  placementId: string
  resourceId: string | null
  state: EmergencyCoverageState
  covered: boolean
  inspectionOverdue: boolean
  reason: string | null
}

export function calculateEmergencyCoverage(input: EmergencyCoverageInput): EmergencyCoverageRow[] {
  return input.placements.filter((placement) => placement.isActive).map((placement) => {
    const assignment = input.assignments.find((item) => item.active && item.placementId === placement.id)
    if (!assignment) return { placementId: placement.id, resourceId: null, state: "uncovered", covered: false, inspectionOverdue: false, reason: "Sin extintor asignado" }
    const resource = input.resources.find((item) => item.id === assignment.resourceId)
    if (!resource || !resource.typeId || !placement.requiredTypeId) {
      return { placementId: placement.id, resourceId: assignment.resourceId, state: "incomplete", covered: false, inspectionOverdue: false, reason: "Clasificación técnica incompleta" }
    }
    if (resource.typeId !== placement.requiredTypeId) {
      return { placementId: placement.id, resourceId: resource.id, state: "uncovered", covered: false, inspectionOverdue: false, reason: "Tipo incompatible" }
    }
    if (resource.status !== "operational") {
      return { placementId: placement.id, resourceId: resource.id, state: "uncovered", covered: false, inspectionOverdue: false, reason: "Extintor no operativo" }
    }
    if (!resource.expiresAt || resource.expiresAt < input.today) {
      return { placementId: placement.id, resourceId: resource.id, state: "uncovered", covered: false, inspectionOverdue: false, reason: "Extintor vencido" }
    }
    const inspectionOverdue = Boolean(resource.nextInspectionAt && resource.nextInspectionAt < input.today)
    return {
      placementId: placement.id,
      resourceId: resource.id,
      state: inspectionOverdue ? "attention" : "covered",
      covered: true,
      inspectionOverdue,
      reason: inspectionOverdue ? "Inspección atrasada" : null,
    }
  })
}
