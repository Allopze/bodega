import { redirect } from "next/navigation"
import { db } from "@/db"
import { fuelLoads, fuelVehicles, fuelSuppliers, worksites } from "@/db/schema"
import { eq, sql, desc, and, gte, lte } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { ReportsView } from "./reports-view"

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  try { await requirePermission("combustibles:view") }
  catch { redirect("/forbidden") }

  const sp = await searchParams
  const startDate = typeof sp.desde === "string" ? sp.desde : undefined
  const endDate = typeof sp.hasta === "string" ? sp.hasta : undefined

  // Build date filter
  const conditions = []
  if (startDate) conditions.push(gte(fuelLoads.loadDate, startDate))
  if (endDate) conditions.push(lte(fuelLoads.loadDate, endDate))
  const where = conditions.length > 0 ? and(...conditions) : undefined

  // Group by month
  const byMonth = await db.select({
    group: fuelLoads.month,
    totalLiters: sql<number>`coalesce(sum(${fuelLoads.liters}), 0)`,
    totalAmount: sql<number>`coalesce(sum(${fuelLoads.totalAmount}), 0)`,
    count: sql<number>`count(*)`,
  }).from(fuelLoads).where(where).groupBy(fuelLoads.month).orderBy(desc(fuelLoads.month))

  // Group by worksite
  const byWorksite = await db.select({
    group: worksites.name,
    totalLiters: sql<number>`coalesce(sum(${fuelLoads.liters}), 0)`,
    totalAmount: sql<number>`coalesce(sum(${fuelLoads.totalAmount}), 0)`,
    count: sql<number>`count(*)`,
  }).from(fuelLoads).leftJoin(worksites, eq(fuelLoads.worksiteId, worksites.id)).where(where).groupBy(worksites.name).orderBy(desc(sql`sum(${fuelLoads.totalAmount})`))

  // Group by vehicle
  const byVehicle = await db.select({
    group: fuelVehicles.plate,
    totalLiters: sql<number>`coalesce(sum(${fuelLoads.liters}), 0)`,
    totalAmount: sql<number>`coalesce(sum(${fuelLoads.totalAmount}), 0)`,
    count: sql<number>`count(*)`,
  }).from(fuelLoads).leftJoin(fuelVehicles, eq(fuelLoads.vehicleId, fuelVehicles.id)).where(where).groupBy(fuelVehicles.plate).orderBy(desc(sql`sum(${fuelLoads.totalAmount})`))

  // Group by supplier
  const bySupplier = await db.select({
    group: fuelSuppliers.name,
    totalLiters: sql<number>`coalesce(sum(${fuelLoads.liters}), 0)`,
    totalAmount: sql<number>`coalesce(sum(${fuelLoads.totalAmount}), 0)`,
    count: sql<number>`count(*)`,
  }).from(fuelLoads).leftJoin(fuelSuppliers, eq(fuelLoads.fuelSupplierId, fuelSuppliers.id)).where(where).groupBy(fuelSuppliers.name).orderBy(desc(sql`sum(${fuelLoads.totalAmount})`))

  return (
    <PageContainer>
      <Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Reportes" }]} />
      <PageHeader
        title="Reportes de combustible"
        description="Análisis de consumo por período, faena, vehículo y proveedor"
      />
      <ReportsView
        byMonth={byMonth}
        byWorksite={byWorksite}
        byVehicle={byVehicle}
        bySupplier={bySupplier}
        currentFilters={{ startDate, endDate }}
      />
    </PageContainer>
  )
}
