import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton, SkeletonPage } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Ralentí"
        description="Tiempo y combustible que los equipos gastan con el motor en vacío"
        breadcrumb={[{ label: "Combustibles", href: "/combustibles" }, { label: "Control", href: "/combustibles/control" }, { label: "Ralentí" }]}
      />
      <Skeleton className="mb-5 h-11 w-full" />
      <Skeleton className="mb-6 h-10 w-2/3" />
      <div className="mb-8 grid gap-6 xl:grid-cols-2">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
      <SkeletonPage rows={8} />
    </PageContainer>
  )
}
