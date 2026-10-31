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

export const metadata: Metadata = { title: "Nueva factura" }

// TODO(L7): esqueleto de la Fase 0; la línea L7 construye la pantalla.
export default async function NuevaFacturaPage() {
  let session
  try { session = await requirePermission("combustibles:create"); assertFuelCostAccess(session) } catch { redirect("/forbidden") }

  return (
    <PageContainer>
      <PageHeader
        title="Nueva factura"
        description="Registra una factura de combustible"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Pagos", href: FUEL_PATHS.pagos }, { label: "Nueva factura" }]} />}
        actions={<FuelHeaderActions />}
      />
      <EmptyState title="Pantalla en preparación" description="Esta pantalla se arma en el rediseño de Combustible." />
    </PageContainer>
  )
}
