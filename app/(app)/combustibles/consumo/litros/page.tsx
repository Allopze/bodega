import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { resolveFuelPeriodForPage } from "@/lib/combustibles/period/server"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

export const metadata: Metadata = { title: "Consumo y rendimiento" }

type SearchParams = Record<string, string | string[] | undefined>

// TODO(L6): esqueleto de la Fase 0; la línea L6 construye la pantalla.
export default async function ConsumoLitrosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:view") } catch { redirect("/forbidden") }
  const period = await resolveFuelPeriodForPage(session, await searchParams)

  return (
    <PageContainer>
      <PageHeader
        title="Consumo y rendimiento"
        description="Litros por faena, equipo y origen del combustible"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Consumo", href: FUEL_PATHS.consumo }, { label: "Litros" }]} />}
        actions={<FuelHeaderActions period={period} />}
      />
      <EmptyState title="Pantalla en preparación" description="Esta pantalla se arma en el rediseño de Combustible." />
    </PageContainer>
  )
}
