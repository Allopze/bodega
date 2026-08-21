import { asc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { fuelVehicles, suppliers, worksites } from "@/db/schema"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"
import type { requirePermission } from "@/lib/auth/can"
import { can } from "@/lib/auth/can"

export async function getFilterOptions(session: Awaited<ReturnType<typeof requirePermission>>) {
  const isGlobal = isGlobalRole(session)
  const wsIds = visibleWorksiteIds(session)
  const worksiteWhere = isGlobal
    ? eq(worksites.isActive, true)
    : wsIds.length > 0
      ? inArray(worksites.id, wsIds)
      : inArray(worksites.id, ["__none__"])

  const [worksiteRows, supplierRows, vehicleRows] = await Promise.all([
    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .where(worksiteWhere)
      .orderBy(asc(worksites.name)),
    db.select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers)
      .where(eq(suppliers.isActive, true))
      .orderBy(asc(suppliers.name)),
    can(session, "combustibles:view")
      ? db.select({ id: fuelVehicles.id, name: fuelVehicles.plate, plate: fuelVehicles.plate })
          .from(fuelVehicles)
          .where(eq(fuelVehicles.isActive, true))
          .orderBy(asc(fuelVehicles.plate))
      : Promise.resolve([]),
  ])

  return {
    worksites: worksiteRows,
    suppliers: supplierRows,
    vehicles: vehicleRows,
  }
}

export function getParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key]
  return typeof value === "string" && value.trim() ? value : undefined
}
