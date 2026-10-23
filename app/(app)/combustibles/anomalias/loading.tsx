import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { SectionNavSkeleton } from "@/components/ui/section-nav-skeleton"
import { SkeletonPage } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Anomalías de combustible"
        breadcrumb={<Breadcrumbs items={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Revisión", href: "/combustibles/revision" }, { label: "Anomalías" }]} />}
      />
      <SectionNavSkeleton tabs={2} />
      <SkeletonPage rows={4} />
    </PageContainer>
  )
}
