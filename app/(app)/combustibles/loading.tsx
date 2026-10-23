import { SkeletonPage } from "@/components/ui/skeleton"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { SectionNavSkeleton } from "@/components/ui/section-nav-skeleton"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Consumo y rendimiento"
        breadcrumb={<Breadcrumbs items={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Consumo y rendimiento" }]} />}
      />
      <SectionNavSkeleton tabs={6} />
      <SkeletonPage rows={8} />
    </PageContainer>
  )
}
