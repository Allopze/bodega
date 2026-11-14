import { DashboardSectionFallback } from "@/components/dashboard/dashboard-section"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"

/** Esqueleto de «Indicadores de combustible»: las dos secciones reservan su alto. */
export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Indicadores de combustible"
        description="Cómo fue el consumo del período y hacia dónde va"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Indicadores" }]} />}
      />
      <div className="flex flex-col gap-10" role="status" aria-label="Cargando indicadores">
        <DashboardSectionFallback />
        <DashboardSectionFallback />
      </div>
    </PageContainer>
  )
}
