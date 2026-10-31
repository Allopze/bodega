import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

export const metadata: Metadata = { title: "Familias de equipos" }

// TODO(L9): esqueleto de la Fase 0; la línea L9 construye la pantalla.
export default async function AjustesFamiliasPage() {
  try { await requirePermission("combustibles:manage_control") } catch { redirect("/forbidden") }

  return (
    <PageContainer>
      <PageHeader
        title="Familias de equipos"
        description="Cómo se agrupan los equipos para comparar su rendimiento"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Ajustes", href: FUEL_PATHS.ajustes }, { label: "Familias de equipos" }]} />}
        actions={<FuelHeaderActions />}
      />
      <EmptyState title="Pantalla en preparación" description="Esta pantalla se arma en el rediseño de Combustible." />
    </PageContainer>
  )
}
