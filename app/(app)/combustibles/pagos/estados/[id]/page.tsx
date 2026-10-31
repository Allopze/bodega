import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { assertFuelCostAccess } from "@/lib/operational-control/capabilities"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

export const metadata: Metadata = { title: "Estado de cuenta" }

// TODO(L7): esqueleto de la Fase 0; la línea L7 construye la pantalla.
export default async function EstadoCuentaPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requirePermission("combustibles:view"); assertFuelCostAccess(session, { global: true }) } catch { redirect("/forbidden") }
  void params

  return (
    <PageContainer>
      <PageHeader
        title="Estado de cuenta"
        description="Detalle del estado de cuenta"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Pagos", href: FUEL_PATHS.pagos }, { label: "Estados de cuenta", href: FUEL_PATHS.estados }, { label: "Detalle" }]} />}
        actions={<FuelHeaderActions />}
      />
      <EmptyState title="Pantalla en preparación" description="Esta pantalla se arma en el rediseño de Combustible." />
    </PageContainer>
  )
}
