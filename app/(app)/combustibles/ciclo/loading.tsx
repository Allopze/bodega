import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { SectionNavSkeleton } from "@/components/ui/section-nav-skeleton"
import { SkeletonPage } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Ciclo físico de combustible"
        breadcrumb={<Breadcrumbs items={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Consumo y rendimiento", href: "/combustibles" }, { label: "Ciclo físico" }]} />}
      />
      <SectionNavSkeleton tabs={6} />
      <SkeletonPage rows={6} />
    </PageContainer>
  )
}
