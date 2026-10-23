import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { SectionNavSkeleton } from "@/components/ui/section-nav-skeleton"
import { SkeletonPage } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Cargas TAE"
        breadcrumb={<Breadcrumbs items={[{ label: "Control operacional", href: "/control-operacional" }, { label: "TAE y sellos" }]} />}
      />
      <SectionNavSkeleton tabs={4} />
      <SkeletonPage rows={7} />
    </PageContainer>
  )
}
