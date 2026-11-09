import { PageContainer } from "@/components/ui/page-container"
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer width="workbench">
      <Skeleton className="mb-4 h-8 w-64" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]" aria-busy="true" aria-label="Cargando el repuesto">
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, index) => <SkeletonRow key={index} cols={4} />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    </PageContainer>
  )
}
