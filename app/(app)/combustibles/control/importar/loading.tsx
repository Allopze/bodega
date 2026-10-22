import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Skeleton, SkeletonPage } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Importar datos del control"
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Control", href: "/combustibles/control" }, { label: "Importar" }]} />}
      />
      <Skeleton className="mb-5 h-11 w-full" />
      <Skeleton className="mb-2 h-6 w-56" />
      <Skeleton className="mb-4 h-4 w-full max-w-xl" />
      <SkeletonPage rows={6} />
    </PageContainer>
  )
}
