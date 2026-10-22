import type { Session } from "next-auth"
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelEquipmentLoads, fuelEquipmentTypes, fuelSupplyMedia, fuelVehicles, worksites } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"
import type { PerformanceFamily, PerformanceUnit } from "@/lib/combustibles/control/contracts"
import { buildLoadWhere, type ControlFilters } from "@/lib/combustibles/control/filters"
import { resolvePagination, type PaginationState } from "@/lib/pagination"
import { DETAIL_PAGE_SIZE, EXPORT_ROW_LIMIT } from "./performance"
import { toNullableNumber, toNumber } from "./shared"

/** Detalle de cargas de la familia (R-05) y opciones de los filtros de las vistas de rendimiento. */

/* ── R-05: detalle de cargas de la familia ───────────────────────────────── */

export interface LoadDetailRow {
  id: string
  occurredAt: string
  worksiteName: string
  code: string | null
  plate: string | null
  meterType: string | null
  meterReading: number | null
  unit: PerformanceUnit | null
  performanceValue: number | null
  performanceStatus: string
  declaredPerformance: number | null
  liters: number
  /** Null cuando quien consulta no tiene `combustibles:view_personal`: el dato no sale del servidor. */
  supervisor: string | null
  reviewStatus: string
  source: string
  mediumName: string | null
}

export interface LoadDetailPage {
  rows: LoadDetailRow[]
  pagination: PaginationState
}

export async function getLoadDetail(
  session: Session,
  filters: ControlFilters,
  options: { includePersonal: boolean; page?: number; all?: boolean },
): Promise<LoadDetailPage> {
  // Bitácora: todo lo no anulado ni duplicado, también las rechazadas y en revisión (con su estado visible).
  const where = and(buildLoadWhere(session, filters), isNull(fuelEquipmentLoads.voidedAt), isNull(fuelEquipmentLoads.duplicateOfId))
  const [{ total } = { total: 0 }] = await db.select({ total: sql<number>`count(*)::int` }).from(fuelEquipmentLoads)
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, fuelEquipmentLoads.vehicleId))
    .leftJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId)).where(where)
  const pagination = options.all
    ? resolvePagination({ pageParam: "1", totalItems: toNumber(total), pageSize: EXPORT_ROW_LIMIT })
    : resolvePagination({ pageParam: String(options.page ?? filters.page), totalItems: toNumber(total), pageSize: DETAIL_PAGE_SIZE })

  const rows = await db.select({
    id: fuelEquipmentLoads.id,
    occurredAt: fuelEquipmentLoads.occurredAt,
    worksiteName: worksites.name,
    code: fuelVehicles.code,
    plate: fuelVehicles.plate,
    meterType: fuelEquipmentLoads.meterType,
    meterReading: fuelEquipmentLoads.meterReading,
    unit: fuelVehicles.performanceUnit,
    performanceValue: fuelEquipmentLoads.performanceValue,
    performanceStatus: fuelEquipmentLoads.performanceStatus,
    declaredPerformance: fuelEquipmentLoads.declaredPerformance,
    liters: fuelEquipmentLoads.liters,
    supervisor: options.includePersonal ? fuelEquipmentLoads.supervisorName : sql<string | null>`null`,
    reviewStatus: fuelEquipmentLoads.reviewStatus,
    source: fuelEquipmentLoads.source,
    mediumName: fuelSupplyMedia.name,
  }).from(fuelEquipmentLoads)
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, fuelEquipmentLoads.vehicleId))
    .leftJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .innerJoin(worksites, eq(worksites.id, fuelEquipmentLoads.worksiteId))
    .leftJoin(fuelSupplyMedia, eq(fuelSupplyMedia.id, fuelEquipmentLoads.supplyMediumId))
    .where(where)
    .orderBy(desc(fuelEquipmentLoads.occurredAt), desc(fuelEquipmentLoads.id))
    .limit(pagination.limit)
    .offset(pagination.offset)

  return {
    pagination,
    rows: rows.map((row) => ({
      id: row.id,
      occurredAt: row.occurredAt,
      worksiteName: row.worksiteName,
      code: row.code,
      plate: row.plate,
      meterType: row.meterType,
      meterReading: toNullableNumber(row.meterReading),
      unit: (row.unit === "km_per_liter" || row.unit === "liters_per_hour" ? row.unit : null) as PerformanceUnit | null,
      performanceValue: toNullableNumber(row.performanceValue),
      performanceStatus: row.performanceStatus,
      declaredPerformance: toNullableNumber(row.declaredPerformance),
      liters: toNumber(row.liters),
      supervisor: row.supervisor ?? null,
      reviewStatus: row.reviewStatus,
      source: row.source,
      mediumName: row.mediumName,
    })),
  }
}

/* ── Opciones de los filtros ─────────────────────────────────────────────── */

export interface VehicleOption { plate: string; code: string | null; brand: string | null; model: string | null }

/** Equipos de la familia dentro del alcance de faena del usuario, para el selector de equipo. */
export async function getFamilyVehicleOptions(session: Session, family: PerformanceFamily): Promise<VehicleOption[]> {
  return db.select({ plate: fuelVehicles.plate, code: fuelVehicles.code, brand: fuelVehicles.brand, model: fuelVehicles.model })
    .from(fuelVehicles)
    .innerJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .where(and(
      eq(fuelEquipmentTypes.performanceFamily, family),
      inArray(fuelVehicles.performanceUnit, ["km_per_liter", "liters_per_hour"]),
      worksiteScopeSql(session, fuelVehicles.worksiteId),
    ))
    .orderBy(sql`${fuelVehicles.code} asc nulls last`, asc(fuelVehicles.plate))
    .limit(3000)
}

export async function getSupplyMediumOptions(): Promise<Array<{ id: string; name: string }>> {
  return db.select({ id: fuelSupplyMedia.id, name: fuelSupplyMedia.name }).from(fuelSupplyMedia)
    .where(eq(fuelSupplyMedia.isActive, true))
    .orderBy(asc(fuelSupplyMedia.sortOrder), asc(fuelSupplyMedia.name))
}
