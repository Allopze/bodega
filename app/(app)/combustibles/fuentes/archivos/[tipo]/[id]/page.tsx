import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAnyPermission } from "@/lib/auth/can"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

export const metadata: Metadata = { title: "Archivo importado" }

// TODO(L8): esqueleto de la Fase 0; la línea L8 construye la pantalla.
export default async function ArchivoImportadoPage({ params }: { params: Promise<{ tipo: string; id: string }> }) {
  try { await requireAnyPermission(["combustibles:import", "combustibles:tae_import", "combustibles:sync_integrations"]) } catch { redirect("/forbidden") }
  void params

  return (
    <PageContainer>
      <PageHeader
        title="Archivo importado"
        description="Detalle del archivo"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Fuentes de datos", href: FUEL_PATHS.fuentes }, { label: "Archivos importados", href: FUEL_PATHS.fuentesArchivos }, { label: "Detalle" }]} />}
        actions={<FuelHeaderActions />}
      />
      <EmptyState title="Pantalla en preparación" description="Esta pantalla se arma en el rediseño de Combustible." />
    </PageContainer>
  )
}
