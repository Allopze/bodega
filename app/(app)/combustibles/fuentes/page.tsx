import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAnyPermission } from "@/lib/auth/can"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"

export const metadata: Metadata = { title: "Fuentes de datos" }

// TODO(L8): esqueleto de la Fase 0; la línea L8 construye la pantalla.
export default async function FuentesPage() {
  try { await requireAnyPermission(["combustibles:import", "combustibles:tae_import", "combustibles:sync_integrations"]) } catch { redirect("/forbidden") }

  return (
    <PageContainer>
      <PageHeader
        title="Fuentes de datos"
        description="De dónde llegan los datos de combustible y cuándo llegaron por última vez"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Fuentes de datos" }]} />}
        actions={<FuelHeaderActions />}
      />
      <EmptyState title="Pantalla en preparación" description="Esta pantalla se arma en el rediseño de Combustible." />
    </PageContainer>
  )
}
