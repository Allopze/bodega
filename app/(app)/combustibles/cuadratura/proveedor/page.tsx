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

export const metadata: Metadata = { title: "Proveedor y terreno" }

type SearchParams = Record<string, string | string[] | undefined>

// TODO(L5): esqueleto de la Fase 0; la línea L5 construye la pantalla.
export default async function CuadraturaProveedorPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:tae_view") } catch { redirect("/forbidden") }
  const period = await resolveFuelPeriodForPage(session, await searchParams)

  return (
    <PageContainer>
      <PageHeader
        title="Proveedor y terreno"
        description="Lo que factura el proveedor contra lo que se registró en terreno"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Cuadratura", href: FUEL_PATHS.cuadratura }, { label: "Proveedor y terreno" }]} />}
        actions={<FuelHeaderActions period={period} />}
      />
      <EmptyState title="Pantalla en preparación" description="Esta pantalla se arma en el rediseño de Combustible." />
    </PageContainer>
  )
}
