import type { Session } from "next-auth"
import { desc, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelLoads, fuelSuppliers, fuelVehicles, worksites } from "@/db/schema"
import { buildFuelLoadsWhere } from "@/lib/combustibles/queries"

export interface FuelReportFilters {
  startDate?: string
  endDate?: string
}

export interface FuelReportRow {
  group: string | null
  totalLiters: number
  totalAmount: number
  count?: number
}

export async function getFuelReportsData(session: Session, filters: FuelReportFilters = {}) {
  const where = buildFuelLoadsWhere(session, filters)

  const [byMonth, byWeek, byWorksite, byVehicle, bySupplier, byProduct] = await Promise.all([
    db.select({
      group: fuelLoads.month,
      totalLiters: sql<number>`coalesce(sum(${fuelLoads.liters}), 0)`,
      totalAmount: sql<number>`coalesce(sum(${fuelLoads.totalAmount}), 0)`,
      count: sql<number>`count(*)`,
    }).from(fuelLoads).where(where).groupBy(fuelLoads.month).orderBy(desc(fuelLoads.month)),
    db.select({
      group: sql<string>`to_char(${fuelLoads.loadDate}::date, 'IYYY-IW')`,
      totalLiters: sql<number>`coalesce(sum(${fuelLoads.liters}), 0)`,
      totalAmount: sql<number>`coalesce(sum(${fuelLoads.totalAmount}), 0)`,
      count: sql<number>`count(*)`,
    }).from(fuelLoads).where(where).groupBy(sql`to_char(${fuelLoads.loadDate}::date, 'IYYY-IW')`).orderBy(desc(sql`to_char(${fuelLoads.loadDate}::date, 'IYYY-IW')`)),
    db.select({
      group: worksites.name,
      totalLiters: sql<number>`coalesce(sum(${fuelLoads.liters}), 0)`,
      totalAmount: sql<number>`coalesce(sum(${fuelLoads.totalAmount}), 0)`,
      count: sql<number>`count(*)`,
    }).from(fuelLoads).leftJoin(worksites, eq(fuelLoads.worksiteId, worksites.id)).where(where).groupBy(worksites.name).orderBy(desc(sql`sum(${fuelLoads.totalAmount})`)),
    db.select({
      group: fuelVehicles.plate,
      totalLiters: sql<number>`coalesce(sum(${fuelLoads.liters}), 0)`,
      totalAmount: sql<number>`coalesce(sum(${fuelLoads.totalAmount}), 0)`,
      count: sql<number>`count(*)`,
    }).from(fuelLoads).leftJoin(fuelVehicles, eq(fuelLoads.vehicleId, fuelVehicles.id)).where(where).groupBy(fuelVehicles.plate).orderBy(desc(sql`sum(${fuelLoads.totalAmount})`)),
    db.select({
      group: fuelSuppliers.name,
      totalLiters: sql<number>`coalesce(sum(${fuelLoads.liters}), 0)`,
      totalAmount: sql<number>`coalesce(sum(${fuelLoads.totalAmount}), 0)`,
      count: sql<number>`count(*)`,
    }).from(fuelLoads).leftJoin(fuelSuppliers, eq(fuelLoads.fuelSupplierId, fuelSuppliers.id)).where(where).groupBy(fuelSuppliers.name).orderBy(desc(sql`sum(${fuelLoads.totalAmount})`)),
    db.select({
      group: fuelLoads.product,
      totalLiters: sql<number>`coalesce(sum(${fuelLoads.liters}), 0)`,
      totalAmount: sql<number>`coalesce(sum(${fuelLoads.totalAmount}), 0)`,
      count: sql<number>`count(*)`,
    }).from(fuelLoads).where(where).groupBy(fuelLoads.product).orderBy(desc(sql`sum(${fuelLoads.totalAmount})`)),
  ])

  return { byMonth, byWeek, byWorksite, byVehicle, bySupplier, byProduct }
}
