import type { Session } from "next-auth"
import { and, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  fuelLoads,
  fuelVehicles,
  maintenanceRecords,
} from "@/db/schema"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"

export async function getFleetOverview(session: Session) {
  const scopedWorksites = isGlobalRole(session) ? null : visibleWorksiteIds(session)
  const vehicleScope = scopedWorksites === null
    ? undefined
    : scopedWorksites.length > 0
      ? inArray(fuelVehicles.worksiteId, scopedWorksites)
      : sql`false`

  const [vehicles, fuelRows, maintenanceRows] = await Promise.all([
    db.query.fuelVehicles.findMany({
      where: vehicleScope,
      with: { worksite: true },
      orderBy: [fuelVehicles.plate],
    }),
    db
      .select({
        vehicleId: fuelLoads.vehicleId,
        totalFuelAmount: sql<number>`COALESCE(SUM(${fuelLoads.totalAmount}), 0)`,
        totalLiters: sql<number>`COALESCE(SUM(${fuelLoads.liters}), 0)`,
        loadCount: sql<number>`COUNT(*)`,
        lastOdometerReading: sql<number>`MAX(${fuelLoads.odometerReading}) FILTER (WHERE ${fuelLoads.odometerReading} IS NOT NULL)`,
        lastHourMeterReading: sql<number>`MAX(${fuelLoads.hourMeterReading}) FILTER (WHERE ${fuelLoads.hourMeterReading} IS NOT NULL)`,
      })
      .from(fuelLoads)
      .where(scopedWorksites === null ? undefined : scopedWorksites.length > 0 ? inArray(fuelLoads.worksiteId, scopedWorksites) : sql`false`)
      .groupBy(fuelLoads.vehicleId),
    db
      .select({
        vehicleId: maintenanceRecords.vehicleId,
        totalMaintenanceAmount: sql<number>`COALESCE(SUM(${maintenanceRecords.totalAmount}), 0)`,
        maintenanceCount: sql<number>`COUNT(*)`,
        lastMaintenanceDate: sql<string>`MAX(${maintenanceRecords.maintenanceDate})`,
      })
      .from(maintenanceRecords)
      .where(and(
        sql`${maintenanceRecords.status} <> 'cancelled'`,
        scopedWorksites === null ? undefined : scopedWorksites.length > 0 ? inArray(maintenanceRecords.worksiteId, scopedWorksites) : sql`false`,
      ))
      .groupBy(maintenanceRecords.vehicleId),
  ])

  const fuelByVehicle = new Map(fuelRows.map((row) => [row.vehicleId, row]))
  const maintenanceByVehicle = new Map(maintenanceRows.map((row) => [row.vehicleId, row]))

  return vehicles.map((vehicle) => {
    const fuel = fuelByVehicle.get(vehicle.id)
    const maintenance = maintenanceByVehicle.get(vehicle.id)
    const totalFuelAmount = Number(fuel?.totalFuelAmount ?? 0)
    const totalMaintenanceAmount = Number(maintenance?.totalMaintenanceAmount ?? 0)
    return {
      id: vehicle.id,
      plate: vehicle.plate,
      type: vehicle.type,
      brand: vehicle.brand,
      model: vehicle.model,
      year: vehicle.year,
      isActive: vehicle.isActive,
      worksiteName: vehicle.worksite?.name ?? "Sin faena",
      totalFuelAmount,
      totalMaintenanceAmount,
      totalOperationalCost: totalFuelAmount + totalMaintenanceAmount,
      totalLiters: Number(fuel?.totalLiters ?? 0),
      loadCount: Number(fuel?.loadCount ?? 0),
      maintenanceCount: Number(maintenance?.maintenanceCount ?? 0),
      lastMaintenanceDate: maintenance?.lastMaintenanceDate ?? null,
      lastOdometerReading: fuel?.lastOdometerReading == null ? null : Number(fuel.lastOdometerReading),
      lastHourMeterReading: fuel?.lastHourMeterReading == null ? null : Number(fuel.lastHourMeterReading),
    }
  })
}
