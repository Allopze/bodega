import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { fuelLoads, fuelVehicles, fuelSuppliers, worksites } from "@/db/schema"
import { desc, eq, and, sql } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { FuelLoadTable } from "./fuel-load-table"
import { FuelDashboardKpis } from "./fuel-kpis"
import { FuelFilters } from "./fuel-filters"

export const metadata: Metadata = { title: "Combustibles" }

const PAGE_SIZE = 50

export default async function CombustiblesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("combustibles:view") }
  catch { redirect("/forbidden") }

  const sp = await searchParams
  const month = typeof sp.month === "string" ? sp.month : undefined
  const serviceType = typeof sp.service === "string" ? sp.service : undefined
  const vehicleId = typeof sp.vehicle === "string" ? sp.vehicle : undefined
  const worksiteId = typeof sp.faena === "string" ? sp.faena : undefined
  const supplierId = typeof sp.proveedor === "string" ? sp.proveedor : undefined
  const product = typeof sp.producto === "string" ? sp.producto : undefined
  const status = typeof sp.status === "string" ? sp.status : undefined
  const page = typeof sp.page === "string" ? Math.max(1, Number(sp.page)) : 1

  // Build filter conditions
  const conditions = []
  if (month) conditions.push(eq(fuelLoads.month, month))
  if (serviceType) conditions.push(eq(fuelLoads.serviceType, serviceType))
  if (vehicleId) conditions.push(eq(fuelLoads.vehicleId, vehicleId))
  if (worksiteId) conditions.push(eq(fuelLoads.worksiteId, worksiteId))
  if (supplierId) conditions.push(eq(fuelLoads.fuelSupplierId, supplierId))
  if (product) conditions.push(eq(fuelLoads.product, product))
  if (status) conditions.push(eq(fuelLoads.status, status))
  const where = conditions.length > 0 ? and(...conditions) : undefined

  // Fetch data
  const [rows, countResult, vehicles, suppliersList, worksitesList] = await Promise.all([
    db.query.fuelLoads.findMany({
      where,
      with: { vehicle: true, supplier: true, worksite: true },
      orderBy: [desc(fuelLoads.loadDate), desc(fuelLoads.createdAt)],
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    db.select({ count: sql<number>`count(*)` }).from(fuelLoads).where(where),
    db.query.fuelVehicles.findMany({ orderBy: [fuelVehicles.plate] }),
    db.query.fuelSuppliers.findMany({ orderBy: [fuelSuppliers.name] }),
    db.query.worksites.findMany({ orderBy: [worksites.name] }),
  ])

  const total = countResult[0]?.count ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  // KPI data for current month
  const currentMonth = month ?? new Date().toISOString().substring(0, 7)
  const [kpiRow] = await db.select({
    totalLiters: sql<number>`coalesce(sum(${fuelLoads.liters}), 0)`,
    totalAmount: sql<number>`coalesce(sum(${fuelLoads.totalAmount}), 0)`,
    count: sql<number>`count(*)`,
  }).from(fuelLoads).where(eq(fuelLoads.month, currentMonth))

  return (
    <PageContainer>
      <Breadcrumbs items={[{ label: "Operaciones", href: "/" }, { label: "Combustibles" }]} />
      <PageHeader
        title="Combustibles"
        description="Control de cargas de combustible por faena y vehículo"
        actions={
          <div className="flex gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link href="/combustibles/importar">⬆ Importar Excel</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/combustibles/nueva">+ Nueva carga</Link>
            </Button>
          </div>
        }
      />

      <FuelDashboardKpis
        totalLiters={kpiRow?.totalLiters ?? 0}
        totalAmount={kpiRow?.totalAmount ?? 0}
        loadCount={kpiRow?.count ?? 0}
        currentMonth={currentMonth}
      />

      <FuelFilters
        vehicles={vehicles}
        suppliers={suppliersList}
        worksites={worksitesList}
        currentFilters={{ month, serviceType, vehicleId, worksiteId, supplierId, product, status }}
      />

      <FuelLoadTable
        rows={rows}
        page={page}
        totalPages={totalPages}
        total={total}
      />
    </PageContainer>
  )
}
