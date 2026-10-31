import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

export const metadata: Metadata = { title: "Agregar histórico de sellos" }

// TODO(L8): esqueleto de la Fase 0; la línea L8 construye la pantalla.
export default async function AgregarSellosPage() {
  try { await requirePermission("combustibles:tae_import") } catch { redirect("/forbidden") }

  return (
    <PageContainer>
      <PageHeader
        title="Agregar histórico de sellos"
        description="La planilla antigua del formulario de sellos"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Fuentes de datos", href: FUEL_PATHS.fuentes }, { label: "Histórico de sellos" }]} />}
        actions={<FuelHeaderActions />}
      />
      <EmptyState title="Pantalla en preparación" description="Esta pantalla se arma en el rediseño de Combustible." />
    </PageContainer>
  )
}
