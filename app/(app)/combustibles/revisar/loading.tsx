import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { SectionNavSkeleton } from "@/components/ui/section-nav-skeleton"
import { Skeleton } from "@/components/ui/skeleton"

/** Esqueleto de «Por revisar»: pestañas, línea de respuesta, chips de tipo y filas de la lista. */
export default function Loading() {
  return (
    <PageContainer>
      <PageHeader title="Por revisar" breadcrumb={<FuelBreadcrumbs items={[{ label: "Por revisar" }]} />} />
      <SectionNavSkeleton tabs={2} />
      <div aria-busy="true" aria-live="polite">
        <span className="sr-only">Cargando lo que espera una decisión…</span>
        <div aria-hidden className="space-y-4">
          <Skeleton className="h-5 w-80 max-w-full" />
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-8 w-32 rounded-full" />)}
          </div>
          <div className="divide-y divide-[var(--color-border)] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="grid gap-3 px-4 py-3 md:grid-cols-[1.5rem_minmax(0,1.1fr)_minmax(0,1.6fr)_9.5rem_7rem] md:items-center">
                <Skeleton className="hidden h-4 w-4 md:block" />
                <div className="space-y-2">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-28" />
                </div>
                <Skeleton className="h-4 w-full" />
                <div className="space-y-1.5 md:ml-auto">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-8 w-20 md:ml-auto" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageContainer>
  )
}
