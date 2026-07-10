import type { Session } from "next-auth"
import { and, eq, gte, isNull, isNotNull, lte, gte as gteNum, lte as lteNum, type SQL } from "drizzle-orm"
import { fuelConsumptionRecords } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"

export interface ConsumptionFilters {
  /** Rango de periodo — se incluyen registros cuyo periodo se solapa con [fromDate, toDate]. */
  fromDate?: string
  toDate?: string
  worksiteId?: string
  fuente?: string
  patente?: string
  vehicleId?: string
  /** "yes" = con vehículo asociado, "no" = sin asociar. */
  associated?: "yes" | "no"
  montoMin?: number
  montoMax?: number
  cantidadMin?: number
  cantidadMax?: number
}

/**
 * Construye el WHERE de registros de consumo aplicando SIEMPRE el aislamiento
 * por faena de la sesión. Punto único de verdad — dashboard, tabla de detalle
 * y server actions lo comparten.
 */
export function buildConsumptionWhere(session: Session, filters: ConsumptionFilters = {}): SQL | undefined {
  const conditions: (SQL | undefined)[] = [
    filters.fromDate ? gte(fuelConsumptionRecords.periodoHasta, filters.fromDate) : undefined,
    filters.toDate ? lte(fuelConsumptionRecords.periodoDesde, filters.toDate) : undefined,
    filters.worksiteId ? eq(fuelConsumptionRecords.worksiteId, filters.worksiteId) : undefined,
    filters.fuente ? eq(fuelConsumptionRecords.fuente, filters.fuente) : undefined,
    filters.patente ? eq(fuelConsumptionRecords.patente, filters.patente.trim().toUpperCase()) : undefined,
    filters.vehicleId ? eq(fuelConsumptionRecords.vehicleId, filters.vehicleId) : undefined,
    filters.associated === "yes" ? isNotNull(fuelConsumptionRecords.vehicleId) : undefined,
    filters.associated === "no" ? isNull(fuelConsumptionRecords.vehicleId) : undefined,
    filters.montoMin != null ? gteNum(fuelConsumptionRecords.monto, filters.montoMin) : undefined,
    filters.montoMax != null ? lteNum(fuelConsumptionRecords.monto, filters.montoMax) : undefined,
    filters.cantidadMin != null ? gteNum(fuelConsumptionRecords.cantidadUnidad, filters.cantidadMin) : undefined,
    filters.cantidadMax != null ? lteNum(fuelConsumptionRecords.cantidadUnidad, filters.cantidadMax) : undefined,
    worksiteScopeSql(session, fuelConsumptionRecords.worksiteId),
  ]
  const defined = conditions.filter((c): c is SQL => c !== undefined)
  return defined.length > 0 ? and(...defined) : undefined
}
