import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { SectionNavSkeleton } from "@/components/ui/section-nav-skeleton"
import { Skeleton, SkeletonPage } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Sellos por mandante"
        description="Conciliación, sellos y cargas en terreno por mandante"
        breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "TAE y sellos", href: "/combustibles/tae" }, { label: "Sellos por mandante" }]}
      />
      <SectionNavSkeleton tabs={4} />
      <Skeleton className="mb-6 h-10 w-2/3" />
      <div className="mb-8 grid gap-3 md:grid-cols-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
      <SkeletonPage rows={8} />
    </PageContainer>
  )
}
