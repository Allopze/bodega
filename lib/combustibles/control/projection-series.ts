import { asc, eq, sql, type SQL } from "drizzle-orm"
import type { Tx } from "@/db"
import { fuelEquipmentLoads, fuelEquipmentTypes, fuelVehicles } from "@/db/schema"
import type { LoadSource, ReviewStatus } from "./contracts"
import { computeVehicleSeries, type SeriesResult } from "./calc/performance-series"
import { loadPerformanceControlContext, thresholdForEquipmentType, type PerformanceControlContext } from "./settings"

/**
 * Recalcula la serie de un equipo y persiste SOLO las filas cuyo resultado
 * cambió. Una serie puede tener miles de cargas: escribirlas todas en cada
 * carga nueva sería reescribir el historial completo por una fila.
 */

const UPDATE_CHUNK = 500

type StoredRow = {
  id: string
  source: string
  occurredAt: string
  liters: number
  meterReading: number | null
  meterReset: boolean
  voidedAt: string | null
  reviewStatus: string
  flagReasons: string[]
  meterType: string | null
  anchorLoadId: string | null
  meterDelta: number | null
  accumulatedLiters: number | null
  performanceUnit: string | null
  performanceValue: number | null
  performanceStatus: string
  duplicateOfId: string | null
}

const numEq = (a: number | null, b: number | null) =>
  a === null || b === null ? a === b : Math.abs(Number(a) - Number(b)) < 1e-6

function changed(stored: StoredRow, next: SeriesResult): boolean {
  return stored.meterType !== next.meterType
    || stored.anchorLoadId !== next.anchorLoadId
    || !numEq(stored.meterDelta, next.meterDelta)
    || !numEq(stored.accumulatedLiters, next.accumulatedLiters)
    || stored.performanceUnit !== next.performanceUnit
    || !numEq(stored.performanceValue, next.performanceValue)
    || stored.performanceStatus !== next.performanceStatus
    || stored.reviewStatus !== next.reviewStatus
    || stored.duplicateOfId !== next.duplicateOfId
    || JSON.stringify(stored.flagReasons ?? []) !== JSON.stringify(next.flagReasons)
}

export async function recomputeVehicleSeries(tx: Tx, vehicleId: string, context?: PerformanceControlContext): Promise<void> {
  const [vehicle] = await tx.select({
    meterType: fuelVehicles.meterType,
    performanceUnit: fuelVehicles.performanceUnit,
    tankCapacityLiters: fuelVehicles.tankCapacityLiters,
    typeSlug: fuelEquipmentTypes.slug,
  })
    .from(fuelVehicles)
    .leftJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .where(eq(fuelVehicles.id, vehicleId))
    .limit(1)
  if (!vehicle) return

  const rows: StoredRow[] = await tx.select({
    id: fuelEquipmentLoads.id,
    source: fuelEquipmentLoads.source,
    occurredAt: fuelEquipmentLoads.occurredAt,
    liters: fuelEquipmentLoads.liters,
    meterReading: fuelEquipmentLoads.meterReading,
    meterReset: fuelEquipmentLoads.meterReset,
    voidedAt: fuelEquipmentLoads.voidedAt,
    reviewStatus: fuelEquipmentLoads.reviewStatus,
    flagReasons: fuelEquipmentLoads.flagReasons,
    meterType: fuelEquipmentLoads.meterType,
    anchorLoadId: fuelEquipmentLoads.anchorLoadId,
    meterDelta: fuelEquipmentLoads.meterDelta,
    accumulatedLiters: fuelEquipmentLoads.accumulatedLiters,
    performanceUnit: fuelEquipmentLoads.performanceUnit,
    performanceValue: fuelEquipmentLoads.performanceValue,
    performanceStatus: fuelEquipmentLoads.performanceStatus,
    duplicateOfId: fuelEquipmentLoads.duplicateOfId,
  })
    .from(fuelEquipmentLoads)
    .where(eq(fuelEquipmentLoads.vehicleId, vehicleId))
    .orderBy(asc(fuelEquipmentLoads.occurredAt), asc(fuelEquipmentLoads.id))
  if (rows.length === 0) return

  const { settings, ruleConfig } = context ?? await loadPerformanceControlContext(tx)
  const results = computeVehicleSeries(
    { meterType: vehicle.meterType, performanceUnit: vehicle.performanceUnit, tankCapacityLiters: vehicle.tankCapacityLiters },
    rows.map((row) => ({
      id: row.id,
      source: row.source as LoadSource,
      occurredAt: row.occurredAt,
      liters: Number(row.liters),
      meterReading: row.meterReading === null ? null : Number(row.meterReading),
      meterReset: row.meterReset,
      voidedAt: row.voidedAt,
      reviewStatus: row.reviewStatus as ReviewStatus,
      flagReasons: row.flagReasons ?? [],
    })),
    { ...settings, thresholdStdDevs: thresholdForEquipmentType(settings, ruleConfig, vehicle.typeSlug) },
  )

  const byId = new Map(rows.map((row) => [row.id, row]))
  const dirty = results.filter((result) => changed(byId.get(result.id)!, result))
  for (let i = 0; i < dirty.length; i += UPDATE_CHUNK) {
    await persistChunk(tx, dirty.slice(i, i + UPDATE_CHUNK))
  }
}

/** Un solo UPDATE … FROM (VALUES …) por bloque, con tipos explícitos para que los NULL no queden como text. */
async function persistChunk(tx: Tx, chunk: SeriesResult[]): Promise<void> {
  const values: SQL[] = chunk.map((r) => sql`(
    ${r.id}::text, ${r.meterType}::text, ${r.anchorLoadId}::text, ${r.meterDelta}::numeric, ${r.accumulatedLiters}::numeric,
    ${r.performanceUnit}::text, ${r.performanceValue}::numeric, ${r.performanceStatus}::text, ${r.reviewStatus}::text,
    ${JSON.stringify(r.flagReasons)}::jsonb, ${r.duplicateOfId}::text
  )`)
  await tx.execute(sql`
    UPDATE fuel_equipment_loads AS l SET
      meter_type = v.meter_type,
      anchor_load_id = v.anchor_load_id,
      meter_delta = v.meter_delta,
      accumulated_liters = v.accumulated_liters,
      performance_unit = v.performance_unit,
      performance_value = v.performance_value,
      performance_status = v.performance_status,
      review_status = v.review_status,
      flag_reasons = v.flag_reasons,
      duplicate_of_id = v.duplicate_of_id,
      updated_at = now()
    FROM (VALUES ${sql.join(values, sql`, `)}) AS v(
      id, meter_type, anchor_load_id, meter_delta, accumulated_liters,
      performance_unit, performance_value, performance_status, review_status,
      flag_reasons, duplicate_of_id
    )
    WHERE l.id = v.id
  `)
}

/** Recalcula varios equipos sin repetir y con un solo contexto de umbrales. */
export async function recomputeVehicles(tx: Tx, vehicleIds: Iterable<string>, context?: PerformanceControlContext): Promise<void> {
  const unique = [...new Set(vehicleIds)]
  if (unique.length === 0) return
  const ctx = context ?? await loadPerformanceControlContext(tx)
  for (const vehicleId of unique) await recomputeVehicleSeries(tx, vehicleId, ctx)
}
