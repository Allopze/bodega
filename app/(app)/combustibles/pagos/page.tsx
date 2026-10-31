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

export const metadata: Metadata = { title: "Pagos" }

type SearchParams = Record<string, string | string[] | undefined>

// TODO(L7): esqueleto de la Fase 0; la línea L7 construye la pantalla.
export default async function PagosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:view_costs"); assertFuelCostAccess(session) } catch { redirect("/forbidden") }
  const period = await resolveFuelPeriodForPage(session, await searchParams)

  return (
    <PageContainer>
      <PageHeader
        title="Pagos"
        description="Facturas de combustible con su neto, IEC e IVA"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Pagos" }]} />}
        actions={<FuelHeaderActions period={period} />}
      />
      <EmptyState title="Pantalla en preparación" description="Esta pantalla se arma en el rediseño de Combustible." />
    </PageContainer>
  )
}
