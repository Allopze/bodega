import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton"
import { SectionNavSkeleton } from "@/components/ui/section-nav-skeleton"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"

/** Esqueleto de «Cargas a equipos»: pestañas, la tira de señales de terreno, barra de filtros y la tabla. */
export default function Loading() {
  return (
    <PageContainer>
      <PageHeader title="Cargas" breadcrumb={<FuelBreadcrumbs items={[{ label: "Cargas" }]} />} />
      <SectionNavSkeleton tabs={2} />
      <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden border-y border-[var(--color-border)] sm:grid-cols-4" aria-hidden>
        {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-[4.25rem] rounded-none" />)}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2" aria-hidden>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-8 w-36" />
      </div>
      <Skeleton className="mb-3 h-4 w-56" aria-hidden />
      <div className="divide-y divide-[var(--color-border)] rounded-[var(--radius-2xl)] border border-[var(--color-border)]" aria-hidden>
        {Array.from({ length: 10 }).map((_, index) => <SkeletonRow key={index} cols={4} />)}
      </div>
    </PageContainer>
  )
}
