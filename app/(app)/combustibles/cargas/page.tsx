import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { resolveFuelPeriodForPage } from "@/lib/combustibles/period/server"

export const metadata: Metadata = { title: "Cargas" }

type SearchParams = Record<string, string | string[] | undefined>

// TODO(L2): esqueleto de la Fase 0; la línea L2 construye la pantalla.
export default async function CargasPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:view") } catch { redirect("/forbidden") }
  const period = await resolveFuelPeriodForPage(session, await searchParams)

  return (
    <PageContainer>
      <PageHeader
        title="Cargas"
        description="Cada carga de combustible a un equipo, venga del formulario en terreno, de una planilla o de una factura"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Cargas" }]} />}
        actions={<FuelHeaderActions period={period} />}
      />
      <EmptyState title="Pantalla en preparación" description="Esta pantalla se arma en el rediseño de Combustible." />
    </PageContainer>
  )
}
