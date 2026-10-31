import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { resolveFuelPeriodForPage } from "@/lib/combustibles/period/server"

export const metadata: Metadata = { title: "Por revisar" }

type SearchParams = Record<string, string | string[] | undefined>

// TODO(L4): esqueleto de la Fase 0; la línea L4 construye la pantalla.
export default async function PorRevisarPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:view") } catch { redirect("/forbidden") }
  const period = await resolveFuelPeriodForPage(session, await searchParams)

  return (
    <PageContainer>
      <PageHeader
        title="Por revisar"
        description="Lo que la plataforma no puede decidir sola: cargas por decidir, casos, patentes sin vincular y pedidos de revisión"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Por revisar" }]} />}
        actions={<FuelHeaderActions period={period} />}
      />
      <EmptyState title="Pantalla en preparación" description="Esta pantalla se arma en el rediseño de Combustible." />
    </PageContainer>
  )
}
