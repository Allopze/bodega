import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { assertFuelCostAccess } from "@/lib/operational-control/capabilities"
import { resolveFuelPeriodForPage } from "@/lib/combustibles/period/server"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

export const metadata: Metadata = { title: "Estados de cuenta" }

type SearchParams = Record<string, string | string[] | undefined>

// TODO(L7): esqueleto de la Fase 0; la línea L7 construye la pantalla.
export default async function EstadosCuentaPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:view"); assertFuelCostAccess(session, { global: true }) } catch { redirect("/forbidden") }
  const period = await resolveFuelPeriodForPage(session, await searchParams)

  return (
    <PageContainer>
      <PageHeader
        title="Estados de cuenta"
        description="El resumen mensual de cada proveedor, con lo que se debe y lo pagado"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Pagos", href: FUEL_PATHS.pagos }, { label: "Estados de cuenta" }]} />}
        actions={<FuelHeaderActions period={period} granularity="month" />}
      />
      <EmptyState title="Pantalla en preparación" description="Esta pantalla se arma en el rediseño de Combustible." />
    </PageContainer>
  )
}
