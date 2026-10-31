import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

export const metadata: Metadata = { title: "Agregar reporte de tarjeta" }

// TODO(L8): esqueleto de la Fase 0; la línea L8 construye la pantalla.
export default async function AgregarTarjetaPage() {
  try { await requirePermission("combustibles:import") } catch { redirect("/forbidden") }

  return (
    <PageContainer>
      <PageHeader
        title="Agregar reporte de tarjeta"
        description="Totales por patente y mes de Copec o Aramco"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Fuentes de datos", href: FUEL_PATHS.fuentes }, { label: "Reporte de tarjeta" }]} />}
        actions={<FuelHeaderActions />}
      />
      <EmptyState title="Pantalla en preparación" description="Esta pantalla se arma en el rediseño de Combustible." />
    </PageContainer>
  )
}
