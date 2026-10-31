import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

export const metadata: Metadata = { title: "Carga" }

// TODO(L2): esqueleto de la Fase 0; la línea L2 construye la pantalla.
export default async function FichaCargaPage({ params }: { params: Promise<{ origen: string; id: string }> }) {
  try { await requirePermission("combustibles:view") } catch { redirect("/forbidden") }
  void params

  return (
    <PageContainer>
      <PageHeader
        title="Carga"
        description="Ficha de la carga"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Cargas", href: FUEL_PATHS.cargas }, { label: "Carga" }]} />}
        actions={<FuelHeaderActions />}
      />
      <EmptyState title="Pantalla en preparación" description="Esta pantalla se arma en el rediseño de Combustible." />
    </PageContainer>
  )
}
