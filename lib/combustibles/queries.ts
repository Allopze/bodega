import type { Session } from "next-auth"
import { and, eq, gte, lte, type SQL } from "drizzle-orm"
import { fuelLoads, fuelVehicles } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { accountableFuelLoadsWhere } from "@/lib/combustibles/load-status"

export interface FuelLoadFilters {
  month?: string
  startDate?: string
  endDate?: string
  serviceType?: string
  vehicleId?: string
  worksiteId?: string
  fuelSupplierId?: string
  product?: string
  productId?: string
  status?: string
}

/**
 * Construye el WHERE de cargas de combustible aplicando SIEMPRE el aislamiento
 * por faena de la sesión. Punto único de verdad para que ninguna lectura olvide
 * el scoping (page.tsx y server actions lo comparten).
 */
export function buildFuelLoadsWhere(
  session: Session,
  filters: FuelLoadFilters = {},
  options: { accountableOnly?: boolean } = {},
): SQL | undefined {
  const conditions: (SQL | undefined)[] = [
    // Los listados administran las cuatro etapas; los agregados sólo cuentan
    // las contabilizables (ver lib/combustibles/load-status.ts).
    options.accountableOnly ? accountableFuelLoadsWhere() : undefined,
    filters.month ? eq(fuelLoads.month, filters.month) : undefined,
    filters.startDate ? gte(fuelLoads.loadDate, filters.startDate) : undefined,
    filters.endDate ? lte(fuelLoads.loadDate, filters.endDate) : undefined,
    filters.serviceType ? eq(fuelLoads.serviceType, filters.serviceType) : undefined,
    filters.vehicleId ? eq(fuelLoads.vehicleId, filters.vehicleId) : undefined,
    filters.worksiteId ? eq(fuelLoads.worksiteId, filters.worksiteId) : undefined,
    filters.fuelSupplierId ? eq(fuelLoads.fuelSupplierId, filters.fuelSupplierId) : undefined,
    filters.product ? eq(fuelLoads.product, filters.product) : undefined,
    filters.productId ? eq(fuelLoads.productId, filters.productId) : undefined,
    filters.status ? eq(fuelLoads.status, filters.status) : undefined,
    worksiteScopeSql(session, fuelLoads.worksiteId),
  ]
  const defined = conditions.filter((c): c is SQL => c !== undefined)
  return defined.length > 0 ? and(...defined) : undefined
}

export function buildFuelVehiclesWhere(session: Session): SQL | undefined {
  return worksiteScopeSql(session, fuelVehicles.worksiteId)
}
