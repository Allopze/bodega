import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { getFuelReportsData } from "@/lib/combustibles/reports"
import { ReportsView } from "./reports-view"

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("combustibles:view") }
  catch { redirect("/forbidden") }

  const sp = await searchParams
  const startDate = typeof sp.desde === "string" ? sp.desde : undefined
  const endDate = typeof sp.hasta === "string" ? sp.hasta : undefined

  const { byMonth, byWeek, byWorksite, byVehicle, bySupplier, byProduct } =
    await getFuelReportsData(session, { startDate, endDate })

  return (
    <PageContainer>
      <Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Reportes" }]} />
      <PageHeader
        title="Reportes de combustible"
        description="Análisis de consumo por período, faena, vehículo y proveedor"
      />
      <ReportsView
        byMonth={byMonth}
        byWeek={byWeek}
        byWorksite={byWorksite}
        byVehicle={byVehicle}
        bySupplier={bySupplier}
        byProduct={byProduct}
        currentFilters={{ startDate, endDate }}
      />
    </PageContainer>
  )
}
