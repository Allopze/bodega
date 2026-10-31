import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

/** Esqueleto del historial de una carga. */
export default function Loading() {
  return (
    <PageContainer width="form">
      <PageHeader title="Historial de la carga" breadcrumb={<FuelBreadcrumbs items={[{ label: "Cargas", href: FUEL_PATHS.cargas }, { label: "Historial" }]} />} />
      <div className="space-y-5" aria-hidden>
        <Skeleton className="h-48 w-full rounded-[var(--radius-2xl)]" />
        <Skeleton className="h-24 w-full rounded-[var(--radius-2xl)]" />
      </div>
    </PageContainer>
  )
}
