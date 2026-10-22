import { eq, inArray } from "drizzle-orm"
import type { Tx } from "@/db"
import { fuelOperationRecords, fuelSupplyMedia, fuelTaeLoadingPoints, fuelTaeSubmissions, fuelVehicles } from "@/db/schema"
import { chileLocalDateTimeToUtc, todayInChile } from "@/lib/utils"
import type { FlagReason, LoadSource } from "./contracts"
import { isFillerDate, isFillerSealNumber } from "./validation"
import { parseInstantMs } from "./calc/performance-series"

/**
 * Lectura de los orígenes de una carga y su traducción a «hechos» de
 * `fuel_equipment_loads`. Aquí no se calcula rendimiento: eso es de la serie.
 */

export interface ProjectedFacts {
  source: LoadSource
  taeSubmissionId: string | null
  operationRecordId: string | null
  vehicleId: string | null
  worksiteId: string
  supplyMediumId: string | null
  loadingPointType: string | null
  occurredAt: string
  month: string
  liters: number
  meterType: "odometer" | "hour_meter" | null
  meterReading: number | null
  driverWorkerId: string | null
  driverName: string | null
  supervisorWorkerId: string | null
  supervisorName: string | null
  declaredPerformance: number | null
  /**
   * Corrección auditada «cambio de tablero o de equipo»: la lectura inicia serie
   * nueva. En cargas de terreno viaja en `raw_row.meterReset === true` (lo escribe
   * la corrección de medidor). `undefined` = el origen no lo decide: se conserva.
   */
  meterReset?: boolean
  /** `undefined` = el origen no decide la anulación (log operacional): se conserva la de la fila. */
  voided?: { at: string; reason: string } | null
  sourceFlags: FlagReason[]
}

export interface SkippedRecord {
  recordId: string
  reason: string
}

const round = (value: number | null, digits: number) => {
  if (value === null || !Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

const asMeterType = (value: string | null | undefined) =>
  value === "odometer" || value === "hour_meter" ? value : null

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const blankToNull = (value: string | null | undefined) => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export async function readTaeFacts(tx: Tx, submissionIds: string[]): Promise<ProjectedFacts[]> {
  if (submissionIds.length === 0) return []
  const rows = await tx.select({
    id: fuelTaeSubmissions.id,
    source: fuelTaeSubmissions.source,
    status: fuelTaeSubmissions.status,
    worksiteId: fuelTaeSubmissions.worksiteId,
    vehicleId: fuelTaeSubmissions.vehicleId,
    vehicleMeterType: fuelVehicles.meterType,
    loadedAt: fuelTaeSubmissions.loadedAt,
    liters: fuelTaeSubmissions.liters,
    meterReading: fuelTaeSubmissions.meterReading,
    driverWorkerId: fuelTaeSubmissions.driverWorkerId,
    driverName: fuelTaeSubmissions.driverNameSnapshot,
    supervisorWorkerId: fuelTaeSubmissions.supervisorWorkerId,
    supervisorName: fuelTaeSubmissions.supervisorNameSnapshot,
    supplyMediumId: fuelTaeSubmissions.supplyMediumId,
    loadingPointType: fuelTaeLoadingPoints.type,
    removedSeal: fuelTaeSubmissions.removedSealNumber,
    installedSeal: fuelTaeSubmissions.installedSealNumber,
    reviewNote: fuelTaeSubmissions.reviewNote,
    reviewedAt: fuelTaeSubmissions.reviewedAt,
    updatedAt: fuelTaeSubmissions.updatedAt,
    rawRow: fuelTaeSubmissions.rawRow,
  })
    .from(fuelTaeSubmissions)
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, fuelTaeSubmissions.vehicleId))
    .leftJoin(fuelTaeLoadingPoints, eq(fuelTaeLoadingPoints.id, fuelTaeSubmissions.loadingPointId))
    .where(inArray(fuelTaeSubmissions.id, submissionIds))

  return rows.map((row) => {
    const occurredAt = new Date(parseInstantMs(row.loadedAt)).toISOString()
    const day = todayInChile(occurredAt)
    const flags: FlagReason[] = []
    const fillerSeal = [row.removedSeal, row.installedSeal].some((seal) => seal != null && isFillerSealNumber(seal))
    if (fillerSeal || isFillerDate(day)) flags.push("filler_value")
    if (!row.vehicleId) flags.push("unknown_vehicle")
    return {
      source: row.source === "legacy_xlsx" ? "legacy_tae" : "field",
      taeSubmissionId: row.id,
      operationRecordId: null,
      vehicleId: row.vehicleId,
      worksiteId: row.worksiteId,
      supplyMediumId: row.supplyMediumId,
      loadingPointType: row.loadingPointType,
      occurredAt,
      month: day.slice(0, 7),
      liters: round(Number(row.liters), 4)!,
      meterType: asMeterType(row.vehicleMeterType),
      meterReading: round(row.meterReading === null ? null : Number(row.meterReading), 2),
      driverWorkerId: row.driverWorkerId,
      driverName: blankToNull(row.driverName),
      supervisorWorkerId: row.supervisorWorkerId,
      supervisorName: blankToNull(row.supervisorName),
      declaredPerformance: null,
      meterReset: isRecord(row.rawRow) && row.rawRow.meterReset === true,
      voided: row.status === "voided"
        ? { at: new Date(parseInstantMs(row.reviewedAt ?? row.updatedAt)).toISOString(), reason: blankToNull(row.reviewNote) ?? "Carga anulada en el control de sellos" }
        : null,
      sourceFlags: flags,
    } satisfies ProjectedFacts
  })
}

/** «Suministro entregado por» → medio: por alias o nombre (mayúsculas, sin espacios dobles), luego por proveedor. */
export interface SupplyMediaIndex {
  byText: Map<string, string>
  bySupplier: Map<string, string>
}

export const normalizeMediumText = (value: string) => value.trim().replace(/\s+/g, " ").toUpperCase()

export async function loadSupplyMediaIndex(tx: Tx): Promise<SupplyMediaIndex> {
  const media = await tx.select({
    id: fuelSupplyMedia.id,
    name: fuelSupplyMedia.name,
    aliases: fuelSupplyMedia.aliases,
    fuelSupplierId: fuelSupplyMedia.fuelSupplierId,
  })
    .from(fuelSupplyMedia)
    .where(eq(fuelSupplyMedia.isActive, true))
    .orderBy(fuelSupplyMedia.sortOrder, fuelSupplyMedia.id)
  const byText = new Map<string, string>()
  const bySupplier = new Map<string, string>()
  for (const medium of media) {
    for (const text of [medium.name, ...(medium.aliases ?? [])]) {
      const key = normalizeMediumText(text)
      if (key && !byText.has(key)) byText.set(key, medium.id)
    }
    if (medium.fuelSupplierId && !bySupplier.has(medium.fuelSupplierId)) bySupplier.set(medium.fuelSupplierId, medium.id)
  }
  return { byText, bySupplier }
}

export function resolveSupplyMedium(index: SupplyMediaIndex, providerName: string | null, fuelSupplierId: string | null): string | null {
  if (providerName) {
    const hit = index.byText.get(normalizeMediumText(providerName))
    if (hit) return hit
  }
  return fuelSupplierId ? index.bySupplier.get(fuelSupplierId) ?? null : null
}

/** Hora «HH:MM» (o «H:MM», «HH:MM:SS») de la planilla; sin hora válida, medianoche. */
export function normalizeLoadTime(value: string | null): string {
  const match = value ? /^(\d{1,2}):(\d{2})/.exec(value.trim()) : null
  if (!match) return "00:00"
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return "00:00"
  return `${String(hours).padStart(2, "0")}:${match[2]}`
}

export async function readOperationFacts(
  tx: Tx,
  recordIds: string[],
): Promise<{ facts: ProjectedFacts[]; skipped: SkippedRecord[] }> {
  if (recordIds.length === 0) return { facts: [], skipped: [] }
  const [rows, media] = await Promise.all([
    tx.select({
      id: fuelOperationRecords.id,
      worksiteId: fuelOperationRecords.worksiteId,
      vehicleId: fuelOperationRecords.vehicleId,
      vehicleMeterType: fuelVehicles.meterType,
      fecha: fuelOperationRecords.fecha,
      horaCarga: fuelOperationRecords.horaCarga,
      horometro: fuelOperationRecords.horometro,
      liters: fuelOperationRecords.liters,
      operador: fuelOperationRecords.operador,
      supervisor: fuelOperationRecords.supervisor,
      proveedorNombre: fuelOperationRecords.proveedorNombre,
      fuelSupplierId: fuelOperationRecords.fuelSupplierId,
      rendimiento: fuelOperationRecords.rendimiento,
    })
      .from(fuelOperationRecords)
      .leftJoin(fuelVehicles, eq(fuelVehicles.id, fuelOperationRecords.vehicleId))
      .where(inArray(fuelOperationRecords.id, recordIds)),
    loadSupplyMediaIndex(tx),
  ])

  const facts: ProjectedFacts[] = []
  const skipped: SkippedRecord[] = []
  for (const row of rows) {
    const liters = Number(row.liters)
    if (!row.worksiteId) { skipped.push({ recordId: row.id, reason: "El registro no tiene faena asignada" }); continue }
    if (!(liters > 0)) { skipped.push({ recordId: row.id, reason: "La carga no tiene litros (0 L o menos)" }); continue }
    let occurredAt: string
    try {
      occurredAt = chileLocalDateTimeToUtc(`${row.fecha.slice(0, 10)}T${normalizeLoadTime(row.horaCarga)}`)
    } catch {
      skipped.push({ recordId: row.id, reason: "La fecha del registro no se puede leer" })
      continue
    }
    const day = todayInChile(occurredAt)
    const flags: FlagReason[] = []
    if (isFillerDate(row.fecha)) flags.push("filler_value")
    if (!row.vehicleId) flags.push("unknown_vehicle")
    facts.push({
      source: "operations_import",
      taeSubmissionId: null,
      operationRecordId: row.id,
      vehicleId: row.vehicleId,
      worksiteId: row.worksiteId,
      supplyMediumId: resolveSupplyMedium(media, row.proveedorNombre, row.fuelSupplierId),
      loadingPointType: null,
      occurredAt,
      month: day.slice(0, 7),
      liters: round(liters, 4)!,
      meterType: asMeterType(row.vehicleMeterType),
      meterReading: round(row.horometro === null ? null : Number(row.horometro), 2),
      driverWorkerId: null,
      driverName: blankToNull(row.operador),
      supervisorWorkerId: null,
      supervisorName: blankToNull(row.supervisor),
      declaredPerformance: round(row.rendimiento === null ? null : Number(row.rendimiento), 4),
      sourceFlags: flags,
    })
  }
  return { facts, skipped }
}
