import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

export const metadata: Metadata = { title: "¿Por dónde llega el combustible?" }

// TODO(L9): esqueleto de la Fase 0; la línea L9 construye la pantalla.
export default async function AjustesMediosPage() {
  try { await requirePermission("combustibles:manage_control") } catch { redirect("/forbidden") }

  return (
    <PageContainer>
      <PageHeader
        title="¿Por dónde llega el combustible?"
        description="Los medios de suministro y sus reglas"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Ajustes", href: FUEL_PATHS.ajustes }, { label: "¿Por dónde llega el combustible?" }]} />}
        actions={<FuelHeaderActions />}
      />
      <EmptyState title="Pantalla en preparación" description="Esta pantalla se arma en el rediseño de Combustible." />
    </PageContainer>
  )
}
