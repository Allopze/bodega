import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { SectionNavSkeleton } from "@/components/ui/section-nav-skeleton"
import { Skeleton, SkeletonPage } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Ralentí"
        description="Tiempo y combustible que los equipos gastan con el motor en vacío"
        breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Consumo y rendimiento", href: "/combustibles" }, { label: "Ralentí" }]}
      />
      <SectionNavSkeleton tabs={6} />
      <Skeleton className="mb-6 h-10 w-2/3" />
      <div className="mb-8 grid gap-6 xl:grid-cols-2">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
      <SkeletonPage rows={8} />
    </PageContainer>
  )
}
