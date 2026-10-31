import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { resolveFuelPeriodForPage } from "@/lib/combustibles/period/server"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { familyFromSlug } from "@/lib/combustibles/control/contracts"

export const metadata: Metadata = { title: "Consumo y rendimiento" }

type SearchParams = Record<string, string | string[] | undefined>

// TODO(L6): esqueleto de la Fase 0; la línea L6 construye la pantalla.
export default async function RendimientoPage({ params, searchParams }: { params: Promise<{ familia: string }>; searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:view") } catch { redirect("/forbidden") }
  if (!familyFromSlug((await params).familia)) notFound()
  const period = await resolveFuelPeriodForPage(session, await searchParams)

  return (
    <PageContainer>
      <PageHeader
        title="Consumo y rendimiento"
        description="Cuánto rinde cada equipo contra su modelo y contra su propio historial"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Consumo", href: FUEL_PATHS.consumo }, { label: "Rendimiento" }]} />}
        actions={<FuelHeaderActions period={period} />}
      />
      <EmptyState title="Pantalla en preparación" description="Esta pantalla se arma en el rediseño de Combustible." />
    </PageContainer>
  )
}
