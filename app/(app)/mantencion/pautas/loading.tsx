import { PageContainer } from "@/components/ui/page-container"
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer>
      <Skeleton className="mb-4 h-8 w-48" />
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Cargando pautas">
        {Array.from({ length: 4 }).map((_, index) => <SkeletonRow key={index} cols={5} />)}
      </div>
    </PageContainer>
  )
}
