import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton, SkeletonPage } from "@/components/ui/skeleton"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Archivo importado"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Fuentes de datos", href: FUEL_PATHS.fuentes }, { label: "Archivos importados", href: FUEL_PATHS.fuentesArchivos }, { label: "Detalle" }]} />}
      />
      <div aria-hidden className="mb-6 rounded-[var(--radius-2xl)] border border-[var(--color-border)] p-5">
        <Skeleton className="mb-4 h-5 w-44" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-9" />)}
        </div>
      </div>
      <SkeletonPage rows={6} />
    </PageContainer>
  )
}
