import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { SectionNavSkeleton } from "@/components/ui/section-nav-skeleton"
import { Skeleton, SkeletonPage } from "@/components/ui/skeleton"

/** Forma de «Pagos › Facturas»: pestañas, frase del período, filtros y la tabla. */
export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Pagos"
        description="Facturas de combustible con su neto, IEC e IVA"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Pagos" }]} />}
      />
      <SectionNavSkeleton tabs={2} />
      <div className="mb-4 space-y-2">
        <Skeleton className="h-4 w-3/4 max-w-xl" />
        <Skeleton className="h-3 w-1/2 max-w-md" />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-28" />
      </div>
      <SkeletonPage rows={8} />
    </PageContainer>
  )
}
