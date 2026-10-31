import type { Metadata } from "next"
import { permanentRedirect, redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { legacyPanelRedirect } from "@/lib/combustibles/legacy-redirects"
import { resolveFuelPeriodForPage } from "@/lib/combustibles/period/server"

export const metadata: Metadata = { title: "Panel de combustible" }

type SearchParams = Record<string, string | string[] | undefined>

// TODO(L1): esqueleto de la Fase 0; la línea L1 construye el Panel.
export default async function PanelPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:view") } catch { redirect("/forbidden") }
  const sp = await searchParams
  // Los enlaces viejos a las vistas de consumo por tarjeta llegan a esta URL.
  const legacy = legacyPanelRedirect(sp)
  if (legacy) permanentRedirect(legacy)
  const period = await resolveFuelPeriodForPage(session, sp)

  return (
    <PageContainer>
      <PageHeader
        title="Panel de combustible"
        description="En qué va el período y qué hace falta para cerrarlo"
        breadcrumb={<FuelBreadcrumbs />}
        actions={<FuelHeaderActions period={period} />}
      />
      <EmptyState title="Pantalla en preparación" description="Esta pantalla se arma en el rediseño de Combustible." />
    </PageContainer>
  )
}
