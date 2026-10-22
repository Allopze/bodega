import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Skeleton, SkeletonPage } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Revisión de cargas"
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Control", href: "/combustibles/control" }, { label: "Revisión" }]} />}
      />
      <PageContainer>
        <Skeleton className="mb-5 h-11 w-full" />
        <Skeleton className="mb-4 h-10 w-80" />
        <SkeletonPage rows={8} />
      </PageContainer>
    </>
  )
}
