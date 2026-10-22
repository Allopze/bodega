import type { Session } from "next-auth"
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelEquipmentLoads, fuelEquipmentTypes, fuelOperationRecords, fuelVehicles, users, worksites } from "@/db/schema"
import { statisticallyValidLoadSql, buildLoadWhere, type ControlFilters } from "./filters"
import { FLAG_REASONS, type FlagReason, type LoadSource, type PerformanceUnit, type ReviewStatus } from "./contracts"

/** Tamaño de página de la cola de revisión (regla del brief: 50 filas). */
export const REVIEW_PAGE_SIZE = 50

/** Pestañas de la cola. El valor es el del parámetro `estado` de la URL. */
export const REVIEW_TABS = [
  { value: "en-revision", status: "flagged", label: "En revisión" },
  { value: "aprobadas", status: "approved", label: "Aprobadas" },
  { value: "rechazadas", status: "rejected", label: "Rechazadas" },
] as const satisfies ReadonlyArray<{ value: string; status: ReviewStatus; label: string }>

export type ReviewTabValue = (typeof REVIEW_TABS)[number]["value"]

/** `estado` desconocido o ausente cae en «En revisión»: es la bandeja de trabajo. */
export function parseReviewTab(raw: string | string[] | undefined): (typeof REVIEW_TABS)[number] {
  const value = Array.isArray(raw) ? raw[0] : raw
  return REVIEW_TABS.find((tab) => tab.value === value) ?? REVIEW_TABS[0]
}

/** `flag_reasons` es jsonb libre: solo pasan los motivos que el contrato conoce. */
export function normalizeFlagReasons(raw: unknown): FlagReason[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is FlagReason => typeof item === "string" && (FLAG_REASONS as readonly string[]).includes(item))
}

export interface ReviewQueueRow {
  id: string
  occurredAt: string
  vehicleCode: string | null
  vehiclePlate: string | null
  worksiteName: string
  liters: number
  meterReading: number | null
  meterType: "odometer" | "hour_meter" | null
  performanceValue: number | null
  performanceUnit: PerformanceUnit | null
  /** Promedio de las cargas estadísticamente válidas del equipo (contexto para juzgar el valor). */
  vehicleAverage: number | null
  vehicleAverageSamples: number
  flagReasons: FlagReason[]
  source: LoadSource
  /** Ruta de la pantalla de origen (detalle TAE o lote del log operacional), si existe. */
  originHref: string | null
  reviewStatus: ReviewStatus
  reviewNote: string | null
  reviewerName: string | null
  reviewedAt: string | null
}

export interface ReviewQueueResult {
  rows: ReviewQueueRow[]
  total: number
  /** Cargas por pestaña con los mismos filtros (alcance, período, faena…). */
  counts: Record<ReviewTabValue, number>
}

/** Ruta de origen de una carga; `null` si la fila no tiene a qué enlazar. */
export function originHrefFor(row: { source: string; taeSubmissionId: string | null; operationBatchId: string | null }): string | null {
  if (row.source === "operations_import") return row.operationBatchId ? `/combustibles/importar/operaciones/${row.operationBatchId}` : null
  return row.taeSubmissionId ? `/combustibles/tae/${row.taeSubmissionId}` : null
}

/**
 * Cola de revisión: cargas de `fuel_equipment_loads` por estado de revisión,
 * dentro del alcance de faena del usuario y de los filtros del control.
 * Conteos y página salen de la base; el promedio del equipo se agrega en SQL
 * solo para los equipos de la página.
 */
export async function getReviewQueue(
  session: Session,
  filters: ControlFilters,
  tab: (typeof REVIEW_TABS)[number],
  pageSize = REVIEW_PAGE_SIZE,
): Promise<ReviewQueueResult> {
  const baseWhere = buildLoadWhere(session, filters)

  const countRows = await db
    .select({ status: fuelEquipmentLoads.reviewStatus, count: sql<number>`count(*)::int` })
    .from(fuelEquipmentLoads)
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, fuelEquipmentLoads.vehicleId))
    .leftJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .where(and(baseWhere, inArray(fuelEquipmentLoads.reviewStatus, REVIEW_TABS.map((item) => item.status))))
    .groupBy(fuelEquipmentLoads.reviewStatus)

  const counts = { "en-revision": 0, aprobadas: 0, rechazadas: 0 } satisfies Record<ReviewTabValue, number>
  for (const row of countRows) {
    const match = REVIEW_TABS.find((item) => item.status === row.status)
    if (match) counts[match.value] = row.count
  }
  const total = counts[tab.value]
  const offset = (Math.min(Math.max(1, filters.page), Math.max(1, Math.ceil(total / pageSize))) - 1) * pageSize

  const pageRows = await db
    .select({
      id: fuelEquipmentLoads.id,
      occurredAt: fuelEquipmentLoads.occurredAt,
      vehicleId: fuelEquipmentLoads.vehicleId,
      vehicleCode: fuelVehicles.code,
      vehiclePlate: fuelVehicles.plate,
      worksiteName: worksites.name,
      liters: fuelEquipmentLoads.liters,
      meterReading: fuelEquipmentLoads.meterReading,
      meterType: fuelEquipmentLoads.meterType,
      performanceValue: fuelEquipmentLoads.performanceValue,
      performanceUnit: fuelEquipmentLoads.performanceUnit,
      flagReasons: fuelEquipmentLoads.flagReasons,
      source: fuelEquipmentLoads.source,
      taeSubmissionId: fuelEquipmentLoads.taeSubmissionId,
      operationBatchId: fuelOperationRecords.batchId,
      reviewStatus: fuelEquipmentLoads.reviewStatus,
      reviewNote: fuelEquipmentLoads.reviewNote,
      reviewerName: users.name,
      reviewedAt: fuelEquipmentLoads.reviewedAt,
    })
    .from(fuelEquipmentLoads)
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, fuelEquipmentLoads.vehicleId))
    .leftJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .innerJoin(worksites, eq(worksites.id, fuelEquipmentLoads.worksiteId))
    .leftJoin(fuelOperationRecords, eq(fuelOperationRecords.id, fuelEquipmentLoads.operationRecordId))
    .leftJoin(users, eq(users.id, fuelEquipmentLoads.reviewedBy))
    .where(and(baseWhere, eq(fuelEquipmentLoads.reviewStatus, tab.status)))
    .orderBy(
      tab.status === "flagged" ? asc(fuelEquipmentLoads.occurredAt) : desc(sql`coalesce(${fuelEquipmentLoads.reviewedAt}, ${fuelEquipmentLoads.occurredAt})`),
      asc(fuelEquipmentLoads.id),
    )
    .limit(pageSize)
    .offset(offset)

  const vehicleIds = [...new Set(pageRows.map((row) => row.vehicleId).filter((id): id is string => Boolean(id)))]
  const averages = vehicleIds.length === 0 ? [] : await db
    .select({
      vehicleId: fuelEquipmentLoads.vehicleId,
      average: sql<number | null>`avg(${fuelEquipmentLoads.performanceValue})::float8`,
      samples: sql<number>`count(*)::int`,
    })
    .from(fuelEquipmentLoads)
    .where(and(statisticallyValidLoadSql, inArray(fuelEquipmentLoads.vehicleId, vehicleIds)))
    .groupBy(fuelEquipmentLoads.vehicleId)
  const averageByVehicle = new Map(averages.map((row) => [row.vehicleId, row]))

  const rows: ReviewQueueRow[] = pageRows.map((row) => {
    const average = row.vehicleId ? averageByVehicle.get(row.vehicleId) : undefined
    return {
      id: row.id,
      occurredAt: row.occurredAt,
      vehicleCode: row.vehicleCode,
      vehiclePlate: row.vehiclePlate,
      worksiteName: row.worksiteName,
      liters: row.liters,
      meterReading: row.meterReading,
      meterType: row.meterType as ReviewQueueRow["meterType"],
      performanceValue: row.performanceValue,
      performanceUnit: row.performanceUnit as PerformanceUnit | null,
      vehicleAverage: average?.average ?? null,
      vehicleAverageSamples: average?.samples ?? 0,
      flagReasons: normalizeFlagReasons(row.flagReasons),
      source: row.source as LoadSource,
      originHref: originHrefFor(row),
      reviewStatus: row.reviewStatus as ReviewStatus,
      reviewNote: row.reviewNote,
      reviewerName: row.reviewerName,
      reviewedAt: row.reviewedAt,
    }
  })

  return { rows, total, counts }
}
