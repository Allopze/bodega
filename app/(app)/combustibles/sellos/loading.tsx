import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { SectionNavSkeleton } from "@/components/ui/section-nav-skeleton"
import { SkeletonPage } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer width="full">
      <PageHeader
        title="Historial de sellos"
        breadcrumb={<Breadcrumbs items={[{ label: "Control operacional", href: "/control-operacional" }, { label: "TAE y sellos", href: "/combustibles/tae" }, { label: "Historial de sellos" }]} />}
      />
      <SectionNavSkeleton tabs={4} />
      <SkeletonPage rows={5} />
    </PageContainer>
  )
}
