/**
 * Análisis especializado de rendimiento por equipo (sección 4).
 *
 * Las únicas dos fuentes con rendimiento ya calculado son el consumo TCT
 * (`fuel_consumption_records.rendimientoPromedio`, agregado por patente/período)
 * y el log operacional (`fuel_operation_records.rendimiento`, por transacción).
 * Ni TAE (`fuel_tae_submissions`) ni facturación (`fuel_loads`) traen un
 * rendimiento precalculado — quedan fuera de este análisis hasta que exista esa
 * fórmula (ver sección 1, criterio de salida).
 *
 * La unidad de cada observación NO se toma de la fila importada (no siempre la
 * declara, y aunque la declare puede estar mal tipeada): se toma de
 * `fuel_vehicles.performance_unit`, el dato canónico de la sección 2. Un
 * vehículo con unidad "not_applicable" (estanques, hidrolavadoras) no entra al
 * análisis — no tiene un concepto de rendimiento que tenga sentido calcular.
 */

import type { Session } from "next-auth"
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelConsumptionRecords, fuelEquipmentTypes, fuelOperationRecords, fuelVehicles, worksites } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { describe, periodVariation, sampleReliability, type DescriptiveStats, type SampleReliability } from "./performance-statistics"

export type PerformanceUnit = "km_per_liter" | "liters_per_hour"
export type EquipmentPreset = "truck" | "loaders_pickups" | "heavy"
export type AggregationLevel = "worksite" | "vehicle" | "equipmentType"

/** Presets generados desde el catálogo de tipos de equipo (sección 2), no
 *  desde listas fijas por faena: cualquier tipo nuevo con esta categoría/slug
 *  entra solo, sin tocar código. */
const PRESET_CATEGORY: Record<EquipmentPreset, { categories?: string[]; slugs?: string[] }> = {
  truck: { categories: ["truck"] },
  loaders_pickups: { slugs: ["cargador", "camioneta"] },
  heavy: { categories: ["heavy"] },
}

export const PRESET_LABEL: Record<EquipmentPreset, string> = {
  truck: "Camiones y tractocamiones",
  loaders_pickups: "Cargadores y camionetas",
  heavy: "Maquinaria pesada",
}

interface RawObservation {
  vehicleId: string
  plate: string
  equipmentCode: string | null
  worksiteId: string | null
  worksiteName: string | null
  equipmentTypeId: string | null
  equipmentTypeName: string | null
  comparisonGroup: string | null
  performanceUnit: PerformanceUnit
  rendimiento: number
}

export interface EquipmentPerformanceFilters {
  preset: EquipmentPreset
  aggregateBy: AggregationLevel
  worksiteId?: string
  from: string // "YYYY-MM-DD"
  to: string
}

export interface PerformanceGroup {
  key: string
  label: string
  unit: PerformanceUnit
  stats: DescriptiveStats
  reliability: SampleReliability
  previousMean: number | null
  variationPct: number | null
  /** p10–p90 del grupo comparable (`comparisonGroup`) declarado por estos equipos, si todos comparten uno. */
  expectedRange: { low: number; high: number } | null
  vehicleIds: string[]
  /** Patente única, para enlazar directo a la bitácora cuando el grupo es un solo equipo. */
  singlePlate: string | null
}

async function fetchObservations(session: Session, filters: Pick<EquipmentPerformanceFilters, "preset" | "worksiteId">, from: string, to: string): Promise<RawObservation[]> {
  const preset = PRESET_CATEGORY[filters.preset]
  const typeWhere = preset.categories
    ? inArray(fuelEquipmentTypes.category, preset.categories)
    : inArray(fuelEquipmentTypes.slug, preset.slugs ?? [])

  const vehicleWhere = and(
    typeWhere,
    sql`${fuelVehicles.performanceUnit} <> 'not_applicable'`,
    worksiteScopeSql(session, fuelVehicles.worksiteId),
    filters.worksiteId ? eq(fuelVehicles.worksiteId, filters.worksiteId) : undefined,
  )

  const [consumptionRows, operationRows] = await Promise.all([
    db.select({
      vehicleId: fuelVehicles.id,
      plate: fuelVehicles.plate,
      equipmentCode: fuelVehicles.code,
      worksiteId: worksites.id,
      worksiteName: worksites.name,
      equipmentTypeId: fuelEquipmentTypes.id,
      equipmentTypeName: fuelEquipmentTypes.name,
      comparisonGroup: fuelVehicles.comparisonGroup,
      performanceUnit: fuelVehicles.performanceUnit,
      rendimiento: fuelConsumptionRecords.rendimientoPromedio,
    })
      .from(fuelConsumptionRecords)
      .innerJoin(fuelVehicles, eq(fuelConsumptionRecords.vehicleId, fuelVehicles.id))
      .innerJoin(fuelEquipmentTypes, eq(fuelVehicles.equipmentTypeId, fuelEquipmentTypes.id))
      .leftJoin(worksites, eq(fuelVehicles.worksiteId, worksites.id))
      .where(and(vehicleWhere, gte(fuelConsumptionRecords.periodoDesde, from), lte(fuelConsumptionRecords.periodoHasta, to), sql`${fuelConsumptionRecords.rendimientoPromedio} > 0`)),

    db.select({
      vehicleId: fuelVehicles.id,
      plate: fuelVehicles.plate,
      equipmentCode: fuelVehicles.code,
      worksiteId: worksites.id,
      worksiteName: worksites.name,
      equipmentTypeId: fuelEquipmentTypes.id,
      equipmentTypeName: fuelEquipmentTypes.name,
      comparisonGroup: fuelVehicles.comparisonGroup,
      performanceUnit: fuelVehicles.performanceUnit,
      rendimiento: fuelOperationRecords.rendimiento,
    })
      .from(fuelOperationRecords)
      .innerJoin(fuelVehicles, eq(fuelOperationRecords.vehicleId, fuelVehicles.id))
      .innerJoin(fuelEquipmentTypes, eq(fuelVehicles.equipmentTypeId, fuelEquipmentTypes.id))
      .leftJoin(worksites, eq(fuelVehicles.worksiteId, worksites.id))
      .where(and(vehicleWhere, gte(fuelOperationRecords.fecha, from), lte(fuelOperationRecords.fecha, to), sql`${fuelOperationRecords.rendimiento} > 0`)),
  ])

  return [...consumptionRows, ...operationRows]
    .filter((row) => row.rendimiento != null && row.performanceUnit !== "not_applicable")
    .map((row) => ({ ...row, rendimiento: Number(row.rendimiento), performanceUnit: row.performanceUnit as PerformanceUnit }))
}

function groupKey(observation: RawObservation, level: AggregationLevel): { key: string; label: string } {
  if (level === "worksite") return { key: observation.worksiteId ?? "sin-faena", label: observation.worksiteName ?? "Sin faena" }
  if (level === "equipmentType") return { key: observation.equipmentTypeId ?? "sin-tipo", label: observation.equipmentTypeName ?? "Sin tipo" }
  return { key: observation.vehicleId, label: observation.equipmentCode ? `${observation.equipmentCode} · ${observation.plate}` : observation.plate }
}

function buildGroups(observations: RawObservation[], level: AggregationLevel, previousObservations: RawObservation[]): PerformanceGroup[] {
  // Separación estricta por unidad: dos equipos con la misma faena/tipo pero
  // unidades distintas nunca comparten un grupo estadístico.
  const buckets = new Map<string, { label: string; unit: PerformanceUnit; values: number[]; vehicleIds: Set<string>; plates: Set<string>; comparisonGroups: Set<string | null> }>()
  for (const observation of observations) {
    const { key, label } = groupKey(observation, level)
    const bucketKey = `${key}::${observation.performanceUnit}`
    const bucket = buckets.get(bucketKey) ?? { label, unit: observation.performanceUnit, values: [], vehicleIds: new Set<string>(), plates: new Set<string>(), comparisonGroups: new Set<string | null>() }
    bucket.values.push(observation.rendimiento)
    bucket.vehicleIds.add(observation.vehicleId)
    bucket.plates.add(observation.plate)
    bucket.comparisonGroups.add(observation.comparisonGroup)
    buckets.set(bucketKey, bucket)
  }

  const previousMeans = new Map<string, number>()
  const previousByBucket = new Map<string, number[]>()
  for (const observation of previousObservations) {
    const { key } = groupKey(observation, level)
    const bucketKey = `${key}::${observation.performanceUnit}`
    const list = previousByBucket.get(bucketKey) ?? []
    list.push(observation.rendimiento)
    previousByBucket.set(bucketKey, list)
  }
  for (const [bucketKey, values] of previousByBucket) previousMeans.set(bucketKey, values.reduce((s, v) => s + v, 0) / values.length)

  // Rango esperado: p10–p90 de los pares (misma faena/tipo/unidad) que comparten
  // grupo de comparación, cuando todos los equipos del bucket declaran el mismo.
  const comparisonPools = new Map<string, number[]>()
  for (const observation of observations) {
    if (!observation.comparisonGroup) continue
    const poolKey = `${observation.comparisonGroup}::${observation.performanceUnit}`
    const list = comparisonPools.get(poolKey) ?? []
    list.push(observation.rendimiento)
    comparisonPools.set(poolKey, list)
  }

  return [...buckets.entries()].map(([bucketKey, bucket]) => {
    const stats = describe(bucket.values)
    const singleComparisonGroup = bucket.comparisonGroups.size === 1 ? [...bucket.comparisonGroups][0] : null
    const pool = singleComparisonGroup ? comparisonPools.get(`${singleComparisonGroup}::${bucket.unit}`) : undefined
    const previousMean = previousMeans.get(bucketKey) ?? null
    return {
      key: bucketKey,
      label: bucket.label,
      unit: bucket.unit,
      stats,
      reliability: sampleReliability(stats.count),
      previousMean,
      variationPct: periodVariation(stats.mean, previousMean),
      expectedRange: pool && pool.length >= 3 ? { low: describe(pool).p10, high: describe(pool).p90 } : null,
      vehicleIds: [...bucket.vehicleIds],
      singlePlate: bucket.plates.size === 1 ? [...bucket.plates][0]! : null,
    }
  })
}

function previousRange(from: string, to: string): { from: string; to: string } {
  const start = new Date(`${from}T00:00:00.000Z`)
  const end = new Date(`${to}T00:00:00.000Z`)
  const spanMs = end.getTime() - start.getTime()
  const previousEnd = new Date(start.getTime() - 24 * 60 * 60 * 1000)
  const previousStart = new Date(previousEnd.getTime() - spanMs)
  return { from: previousStart.toISOString().slice(0, 10), to: previousEnd.toISOString().slice(0, 10) }
}

export async function getEquipmentPerformanceAnalysis(session: Session, filters: EquipmentPerformanceFilters): Promise<PerformanceGroup[]> {
  const previous = previousRange(filters.from, filters.to)
  const [observations, previousObservations] = await Promise.all([
    fetchObservations(session, filters, filters.from, filters.to),
    fetchObservations(session, filters, previous.from, previous.to),
  ])
  return buildGroups(observations, filters.aggregateBy, previousObservations)
    .sort((a, b) => b.stats.count - a.stats.count)
}
