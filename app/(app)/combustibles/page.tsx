import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { fuelLoads, fuelVehicles, fuelSuppliers, worksites } from "@/db/schema"
import { desc, eq, inArray, sql } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { buildFuelLoadsWhere, buildFuelVehiclesWhere } from "@/lib/combustibles/queries"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { FuelLoadTable } from "./fuel-load-table"
import { ImportFuelLoadsModal } from "./import-fuel-modal"
import { FuelDashboardKpis } from "./fuel-kpis"
import { FuelFilters } from "./fuel-filters"
import { MonthlyEvolutionChart, CategoryBarChart, ProductPieChart } from "./fuel-charts-lazy"
import { ExportXlsxButton } from "./export-button"

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

  const startDate = typeof sp.startDate === "string" ? sp.startDate : undefined
  const endDate = typeof sp.endDate === "string" ? sp.endDate : undefined

  // Filtros + aislamiento por faena (scope) en un solo lugar.
  const where = buildFuelLoadsWhere(session, {
    month, startDate, endDate, serviceType, vehicleId, worksiteId,
    fuelSupplierId: supplierId, product, status,
  })
  const worksiteScope = resolveWorksiteScope(session)

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
    db.query.fuelVehicles.findMany({
      where: buildFuelVehiclesWhere(session),
      orderBy: [fuelVehicles.plate],
    }),
    db.query.fuelSuppliers.findMany({ orderBy: [fuelSuppliers.name] }),
    worksiteScope.mode === "none"
      ? Promise.resolve([])
      : db.query.worksites.findMany({
          where: worksiteScope.mode === "some" ? inArray(worksites.id, worksiteScope.ids) : undefined,
          orderBy: [worksites.name],
        }),
  ])

  const total = countResult[0]?.count ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  // KPIs over the filtered set (all data when no filter), consistent with the charts.
  const [kpiRow] = await db.select({
    totalLiters: sql<number>`coalesce(sum(${fuelLoads.liters}), 0)`,
    totalAmount: sql<number>`coalesce(sum(${fuelLoads.totalAmount}), 0)`,
    count: sql<number>`count(*)`,
  }).from(fuelLoads).where(where)

  // Chart data
  const [chartByMonth, chartByWorksite, chartByProduct, chartByVehicle] = await Promise.all([
    db.select({
      group: fuelLoads.month,
      totalLiters: sql<number>`coalesce(sum(${fuelLoads.liters}), 0)`,
      totalAmount: sql<number>`coalesce(sum(${fuelLoads.totalAmount}), 0)`,
      count: sql<number>`count(*)`,
    }).from(fuelLoads).where(where).groupBy(fuelLoads.month).orderBy(fuelLoads.month),
    db.select({
      group: worksites.name,
      totalLiters: sql<number>`coalesce(sum(${fuelLoads.liters}), 0)`,
      totalAmount: sql<number>`coalesce(sum(${fuelLoads.totalAmount}), 0)`,
    }).from(fuelLoads).leftJoin(worksites, eq(fuelLoads.worksiteId, worksites.id)).where(where).groupBy(worksites.name).orderBy(desc(sql`sum(${fuelLoads.totalAmount})`)),
    db.select({
      group: fuelLoads.product,
      totalLiters: sql<number>`coalesce(sum(${fuelLoads.liters}), 0)`,
      totalAmount: sql<number>`coalesce(sum(${fuelLoads.totalAmount}), 0)`,
    }).from(fuelLoads).where(where).groupBy(fuelLoads.product).orderBy(desc(sql`sum(${fuelLoads.totalAmount})`)),
    db.select({
      group: fuelVehicles.plate,
      totalLiters: sql<number>`coalesce(sum(${fuelLoads.liters}), 0)`,
      totalAmount: sql<number>`coalesce(sum(${fuelLoads.totalAmount}), 0)`,
    }).from(fuelLoads).leftJoin(fuelVehicles, eq(fuelLoads.vehicleId, fuelVehicles.id)).where(where).groupBy(fuelVehicles.plate).orderBy(desc(sql`sum(${fuelLoads.totalAmount})`)),
  ])

  // Period label for the KPI header (range of months present in the filtered set).
  const monthsPresent = chartByMonth.map((c) => c.group).filter((m): m is string => !!m)
  const periodLabel = monthsPresent.length === 0
    ? "Sin datos"
    : monthsPresent[0] === monthsPresent[monthsPresent.length - 1]
      ? monthsPresent[0]!
      : `${monthsPresent[0]} — ${monthsPresent[monthsPresent.length - 1]}`

  return (
    <PageContainer>
      <PageHeader
        title="Combustibles"
        description="Control de cargas de combustible por faena y vehículo"
        breadcrumb={<Breadcrumbs items={[{ label: "Adquisiciones", href: "/" }, { label: "Combustibles" }]} />}
        headerActions={
          <div className="flex gap-2">
            <ExportXlsxButton filters={{ month, serviceType, vehicleId, worksiteId, supplierId, product, status }} />
            <ImportFuelLoadsModal worksites={worksitesList} />
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
        periodLabel={periodLabel}
      />

      <FuelFilters
        vehicles={vehicles}
        suppliers={suppliersList}
        worksites={worksitesList}
        currentFilters={{ month, serviceType, vehicleId, worksiteId, supplierId, product, status, startDate, endDate }}
      />

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Evolución mensual</CardTitle></CardHeader>
          <CardContent>
            <MonthlyEvolutionChart data={chartByMonth} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Por producto</CardTitle></CardHeader>
          <CardContent>
            <ProductPieChart data={chartByProduct} />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Top faenas por gasto</CardTitle></CardHeader>
          <CardContent>
            <CategoryBarChart data={chartByWorksite} title="Faenas" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Top vehículos por gasto</CardTitle></CardHeader>
          <CardContent>
            <CategoryBarChart data={chartByVehicle} title="Vehículos" />
          </CardContent>
        </Card>
      </div>

      <FuelLoadTable
        rows={rows}
        page={page}
        totalPages={totalPages}
        total={total}
      />
    </PageContainer>
  )
}
