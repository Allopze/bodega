import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton"
import { SectionNavSkeleton } from "@/components/ui/section-nav-skeleton"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

/** Esqueleto de «Tarjetas (total por patente y mes)». */
export default function Loading() {
  return (
    <PageContainer>
      <PageHeader title="Tarjetas (total por patente y mes)" breadcrumb={<FuelBreadcrumbs items={[{ label: "Cargas", href: FUEL_PATHS.cargas }, { label: "Tarjetas" }]} />} />
      <SectionNavSkeleton tabs={2} />
      <Skeleton className="mb-4 h-16 w-full" aria-hidden />
      <div className="mb-4 flex flex-wrap items-center gap-2" aria-hidden>
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-36" />
      </div>
      <div className="divide-y divide-[var(--color-border)] rounded-[var(--radius-2xl)] border border-[var(--color-border)]" aria-hidden>
        {Array.from({ length: 10 }).map((_, index) => <SkeletonRow key={index} cols={4} />)}
      </div>
    </PageContainer>
  )
}
