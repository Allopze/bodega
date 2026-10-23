import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { SectionNavSkeleton } from "@/components/ui/section-nav-skeleton"
import { Skeleton, SkeletonPage } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Revisión de cargas"
        breadcrumb={<Breadcrumbs items={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Revisión", href: "/combustibles/revision" }, { label: "Cargas marcadas" }]} />}
      />
      <SectionNavSkeleton tabs={2} />
      <Skeleton className="mb-4 h-10 w-80" />
      <SkeletonPage rows={8} />
    </PageContainer>
  )
}
