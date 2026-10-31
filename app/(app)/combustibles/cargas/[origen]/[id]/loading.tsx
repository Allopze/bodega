import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

/** Esqueleto de la ficha de una carga: la tira de datos y dos columnas de secciones. */
export default function Loading() {
  return (
    <PageContainer width="workbench">
      <PageHeader title="Carga" breadcrumb={<FuelBreadcrumbs items={[{ label: "Cargas", href: FUEL_PATHS.cargas }, { label: "Carga" }]} />} />
      <div className="space-y-5" aria-hidden>
        <div className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] p-5">
          <Skeleton className="mb-4 h-5 w-40" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="space-y-2"><Skeleton className="h-3 w-16" /><Skeleton className="h-5 w-24" /></div>
            ))}
          </div>
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <Skeleton className="h-56 w-full rounded-[var(--radius-2xl)]" />
          <Skeleton className="h-56 w-full rounded-[var(--radius-2xl)]" />
        </div>
      </div>
    </PageContainer>
  )
}
