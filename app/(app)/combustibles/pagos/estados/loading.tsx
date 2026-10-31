import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { SectionNavSkeleton } from "@/components/ui/section-nav-skeleton"
import { Skeleton, SkeletonPage } from "@/components/ui/skeleton"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

/** Forma de «Pagos › Estados de cuenta»: pestañas, la frase de lo que se debe y la tabla. */
export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Estados de cuenta"
        description="El resumen mensual de cada proveedor, con lo que se debe y lo pagado"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Pagos", href: FUEL_PATHS.pagos }, { label: "Estados de cuenta" }]} />}
      />
      <SectionNavSkeleton tabs={2} />
      <div className="mb-4 space-y-2">
        <Skeleton className="h-4 w-3/4 max-w-xl" />
        <Skeleton className="h-4 w-1/2 max-w-md" />
      </div>
      <SkeletonPage rows={5} />
    </PageContainer>
  )
}
