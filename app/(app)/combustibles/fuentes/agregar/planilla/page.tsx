import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { isGlobalRole } from "@/lib/auth/scope"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

export const metadata: Metadata = { title: "Agregar planilla de cargas" }

// TODO(L8): esqueleto de la Fase 0; la línea L8 construye la pantalla.
export default async function AgregarPlanillaPage() {
  let session
  try { session = await requirePermission("combustibles:import"); if (!isGlobalRole(session)) throw new Error("global") } catch { redirect("/forbidden") }

  return (
    <PageContainer>
      <PageHeader
        title="Agregar planilla de cargas"
        description="El consolidado con una fila por carga; se revisa antes de guardar"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Fuentes de datos", href: FUEL_PATHS.fuentes }, { label: "Planilla de cargas" }]} />}
        actions={<FuelHeaderActions />}
      />
      <EmptyState title="Pantalla en preparación" description="Esta pantalla se arma en el rediseño de Combustible." />
    </PageContainer>
  )
}
