import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { SectionNavSkeleton } from "@/components/ui/section-nav-skeleton"
import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader title="Rendimiento" breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Consumo y rendimiento", href: "/combustibles" }, { label: "Rendimiento" }]} />
      <SectionNavSkeleton tabs={6} />
      <div className="mb-6 flex flex-wrap gap-2.5" aria-hidden>
        {[1, 2, 3, 4, 5].map((item) => <Skeleton key={item} className="h-10 w-44" />)}
      </div>
      <div role="status" aria-label="Cargando rendimiento" className="space-y-8">
        <span className="sr-only">Cargando rendimiento</span>
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </PageContainer>
  )
}
