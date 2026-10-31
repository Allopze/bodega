import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton, SkeletonPage } from "@/components/ui/skeleton"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Archivos importados"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Fuentes de datos", href: FUEL_PATHS.fuentes }, { label: "Archivos importados" }]} />}
      />
      <div aria-hidden className="mb-4 flex flex-wrap gap-2">
        {[28, 36, 32, 40, 36].map((width, index) => <Skeleton key={index} className="h-9 rounded-full" style={{ width: `${width * 4}px` }} />)}
      </div>
      <SkeletonPage rows={8} />
    </PageContainer>
  )
}
