import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton, SkeletonPage } from "@/components/ui/skeleton"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

/** Forma del detalle: la franja de cifras, dos tarjetas (pagos y desglose) y la lista de cargas. */
export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Estado de cuenta"
        description="Detalle del estado de cuenta"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Pagos", href: FUEL_PATHS.pagos }, { label: "Estados de cuenta", href: FUEL_PATHS.estados }, { label: "Detalle" }]} />}
      />
      <div className="space-y-6">
        <Skeleton className="h-28 w-full rounded-[var(--radius-2xl)]" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Skeleton className="h-44 w-full rounded-[var(--radius-2xl)]" />
          <Skeleton className="h-44 w-full rounded-[var(--radius-2xl)]" />
        </div>
        <SkeletonPage rows={6} />
      </div>
    </PageContainer>
  )
}
